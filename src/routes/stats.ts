import { Router, Request, Response } from "express";
import prisma from "../prisma";

const router = Router();

/**
 * @openapi
 * /api/stats:
 *   get:
 *     summary: Get overview statistics
 *     description: >
 *       Returns comprehensive statistics including totals, recent activity,
 *       per-log breakdowns with growth metrics, per-monitor activity,
 *       ingestion lag, hourly histogram, and cross-monitor consistency.
 *     tags:
 *       - Statistics
 *     responses:
 *       200:
 *         description: Comprehensive statistics
 */
router.get("/", async (_req: Request, res: Response) => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // --- Parallel batch 1: aggregate counts ---
  const [
    totalSths,
    last1h,
    last24h,
    lastWeek,
    logGroups,
    monitorGroups,
    oldestSth,
    newestSth,
  ] = await Promise.all([
    prisma.sth.count(),
    prisma.sth.count({ where: { storedAt: { gte: oneHourAgo } } }),
    prisma.sth.count({ where: { storedAt: { gte: oneDayAgo } } }),
    prisma.sth.count({ where: { storedAt: { gte: oneWeekAgo } } }),
    prisma.sth.groupBy({
      by: ["logId"],
      _count: { id: true },
      _min: { storedAt: true, treeSize: true },
      _max: { storedAt: true, treeSize: true },
    }),
    prisma.sth.groupBy({
      by: ["monitorId"],
      _count: { id: true },
      _min: { storedAt: true },
      _max: { storedAt: true },
    }),
    prisma.sth.findFirst({ orderBy: { storedAt: "asc" } }),
    prisma.sth.findFirst({ orderBy: { storedAt: "desc" } }),
  ]);

  // --- Per-log detailed stats ---
  const logs = await Promise.all(
    logGroups.map(async (group) => {
      const [latest, oldest, sths24h, monitors] = await Promise.all([
        prisma.sth.findFirst({
          where: { logId: group.logId },
          orderBy: { storedAt: "desc" },
        }),
        prisma.sth.findFirst({
          where: { logId: group.logId },
          orderBy: { storedAt: "asc" },
        }),
        prisma.sth.count({
          where: { logId: group.logId, storedAt: { gte: oneDayAgo } },
        }),
        prisma.sth.groupBy({
          by: ["monitorId"],
          where: { logId: group.logId },
          _count: { id: true },
          _max: { storedAt: true },
        }),
      ]);

      const minTree = Number(group._min.treeSize ?? 0);
      const maxTree = Number(group._max.treeSize ?? 0);
      const treeGrowth = maxTree - minTree;

      // Staleness: seconds since last STH was stored
      const lastSeenDate = group._max.storedAt;
      const staleness_seconds = lastSeenDate
        ? Math.round((now.getTime() - lastSeenDate.getTime()) / 1000)
        : null;

      // Ingestion lag: difference between STH timestamp and stored_at
      let avg_ingestion_lag_ms: number | null = null;
      if (latest && oldest) {
        const lags = await prisma.sth.findMany({
          where: { logId: group.logId },
          orderBy: { storedAt: "desc" },
          take: 50,
          select: { timestamp: true, storedAt: true },
        });
        if (lags.length > 0) {
          const totalLag = lags.reduce((sum, s) => {
            return sum + (s.storedAt.getTime() - Number(s.timestamp));
          }, 0);
          avg_ingestion_lag_ms = Math.round(totalLag / lags.length);
        }
      }

      return {
        log_id: group.logId,
        sth_count: group._count.id,
        sths_last_24h: sths24h,
        latest_tree_size: latest ? Number(latest.treeSize) : null,
        latest_timestamp: latest ? Number(latest.timestamp) : null,
        oldest_tree_size: oldest ? Number(oldest.treeSize) : null,
        tree_growth_total: treeGrowth,
        first_seen: group._min.storedAt,
        last_seen: group._max.storedAt,
        staleness_seconds,
        avg_ingestion_lag_ms,
        monitor_count: monitors.length,
        monitors: monitors.map((m) => ({
          monitor_id: m.monitorId,
          sth_count: m._count.id,
          last_seen: m._max.storedAt,
        })),
      };
    })
  );

  // --- Per-monitor stats ---
  const monitors = monitorGroups.map((m) => ({
    monitor_id: m.monitorId,
    sth_count: m._count.id,
    first_seen: m._min.storedAt,
    last_seen: m._max.storedAt,
    staleness_seconds: m._max.storedAt
      ? Math.round((now.getTime() - m._max.storedAt.getTime()) / 1000)
      : null,
  }));

  // --- Hourly histogram (last 24h) ---
  const hourlyBuckets: { hour: string; count: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const bucketStart = new Date(now.getTime() - (i + 1) * 60 * 60 * 1000);
    const bucketEnd = new Date(now.getTime() - i * 60 * 60 * 1000);
    const count = await prisma.sth.count({
      where: { storedAt: { gte: bucketStart, lt: bucketEnd } },
    });
    hourlyBuckets.push({
      hour: bucketStart.toISOString().slice(0, 13) + ":00Z",
      count,
    });
  }

  // --- 5-minute histogram (last 1h) ---
  const fiveMinBuckets: { time: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const bucketStart = new Date(now.getTime() - (i + 1) * 5 * 60 * 1000);
    const bucketEnd = new Date(now.getTime() - i * 5 * 60 * 1000);
    const count = await prisma.sth.count({
      where: { storedAt: { gte: bucketStart, lt: bucketEnd } },
    });
    fiveMinBuckets.push({
      time: bucketStart.toISOString().slice(11, 16) + "Z",
      count,
    });
  }

  // --- Cross-monitor consistency per log ---
  const consistency = await Promise.all(
    logGroups.map(async (group) => {
      // Get the latest STH from each monitor for this log
      const monitorIds = await prisma.sth.groupBy({
        by: ["monitorId"],
        where: { logId: group.logId },
      });

      const latestPerMonitor = await Promise.all(
        monitorIds.map(async (m) => {
          const sth = await prisma.sth.findFirst({
            where: { logId: group.logId, monitorId: m.monitorId },
            orderBy: { storedAt: "desc" },
          });
          return sth
            ? {
                monitor_id: sth.monitorId,
                tree_size: Number(sth.treeSize),
                root_hash: sth.rootHash,
                timestamp: Number(sth.timestamp),
              }
            : null;
        })
      );

      const valid = latestPerMonitor.filter(Boolean) as {
        monitor_id: string;
        tree_size: number;
        root_hash: string;
        timestamp: number;
      }[];

      // Check if all monitors agree on the same root_hash for the same tree_size
      const byTreeSize = new Map<number, Set<string>>();
      for (const entry of valid) {
        if (!byTreeSize.has(entry.tree_size)) {
          byTreeSize.set(entry.tree_size, new Set());
        }
        byTreeSize.get(entry.tree_size)!.add(entry.root_hash);
      }
      const hasConflict = [...byTreeSize.values()].some((hashes) => hashes.size > 1);

      return {
        log_id: group.logId,
        monitor_count: valid.length,
        consistent: !hasConflict,
        latest_per_monitor: valid,
      };
    })
  );

  // --- Uptime / data range ---
  const dataRange = {
    oldest_stored_at: oldestSth?.storedAt ?? null,
    newest_stored_at: newestSth?.storedAt ?? null,
    span_hours: oldestSth && newestSth
      ? Math.round(
          (newestSth.storedAt.getTime() - oldestSth.storedAt.getTime()) /
            (1000 * 60 * 60)
        )
      : 0,
  };

  // --- Ingestion rates ---
  const ingestionRates = {
    per_hour: totalSths > 0 && dataRange.span_hours > 0
      ? Math.round((totalSths / dataRange.span_hours) * 100) / 100
      : 0,
    per_day: totalSths > 0 && dataRange.span_hours > 0
      ? Math.round((totalSths / (dataRange.span_hours / 24)) * 100) / 100
      : 0,
  };

  res.json({
    total_sths: totalSths,
    unique_logs: logGroups.length,
    unique_monitors: monitorGroups.length,
    data_range: dataRange,
    ingestion_rates: ingestionRates,
    recent_activity: {
      last_1h: last1h,
      last_24h: last24h,
      last_7d: lastWeek,
    },
    hourly_histogram: hourlyBuckets,
    five_min_histogram: fiveMinBuckets,
    logs,
    monitors,
    consistency,
  });
});

export default router;
