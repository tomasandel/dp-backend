import { Router, Request, Response } from "express";
import prisma from "../prisma";
import { resolveLogNames } from "../ct-log-list";

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
  const queryStart = Date.now();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // --- Parallel batch 1: aggregate counts ---
  const [
    totalSths,
    last1h,
    last24h,
    logGroups,
    monitorGroups,
    oldestSth,
    newestSth,
  ] = await Promise.all([
    prisma.sth.count(),
    prisma.sth.count({ where: { storedAt: { gte: oneHourAgo } } }),
    prisma.sth.count({ where: { storedAt: { gte: oneDayAgo } } }),
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

  // --- Resolve log names from CT log list ---
  const logNameMap = await resolveLogNames(logGroups.map((g) => g.logId));

  // --- Per-log detailed stats ---
  const logs = await Promise.all(
    logGroups.map(async (group) => {
      const [latest, oldest, sths24h, monitors, sths1hAgo] = await Promise.all([
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
        prisma.sth.count({
          where: { logId: group.logId, storedAt: { gte: oneHourAgo } },
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

      // Growth rate: certs added per hour over observation window
      const firstSeen = group._min.storedAt;
      const spanMs = firstSeen && lastSeenDate
        ? lastSeenDate.getTime() - firstSeen.getTime()
        : 0;
      const spanHours = spanMs / (1000 * 60 * 60);
      const growth_per_hour = spanHours > 0
        ? Math.round((treeGrowth / spanHours) * 100) / 100
        : 0;

      // STH freshness: how old is the CT log's own timestamp vs now
      const sth_freshness_seconds = latest
        ? Math.round((now.getTime() - Number(latest.timestamp)) / 1000)
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
        log_name: logNameMap.get(group.logId) ?? null,
        sth_count: group._count.id,
        sths_last_1h: sths1hAgo,
        sths_last_24h: sths24h,
        latest_tree_size: latest ? Number(latest.treeSize) : null,
        latest_timestamp: latest ? Number(latest.timestamp) : null,
        oldest_tree_size: oldest ? Number(oldest.treeSize) : null,
        tree_growth_total: treeGrowth,
        growth_per_hour,
        sth_freshness_seconds,
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

  // --- Per-monitor stats with log coverage ---
  const monitors = await Promise.all(
    monitorGroups.map(async (m) => {
      const coveredLogs = await prisma.sth.groupBy({
        by: ["logId"],
        where: { monitorId: m.monitorId },
      });
      return {
        monitor_id: m.monitorId,
        sth_count: m._count.id,
        log_count: coveredLogs.length,
        first_seen: m._min.storedAt,
        last_seen: m._max.storedAt,
        staleness_seconds: m._max.storedAt
          ? Math.round((now.getTime() - m._max.storedAt.getTime()) / 1000)
          : null,
      };
    })
  );

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

  // --- Database / system stats ---
  const dbStats = await prisma.$queryRawUnsafe<{ size: string }[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('sths')) AS size`
  );

  res.json({
    total_sths: totalSths,
    unique_logs: logGroups.length,
    unique_monitors: monitorGroups.length,
    data_range: dataRange,
    ingestion_rates: ingestionRates,
    recent_activity: {
      last_1h: last1h,
      last_24h: last24h,
    },
    hourly_histogram: hourlyBuckets,
    five_min_histogram: fiveMinBuckets,
    logs,
    monitors,
    system: {
      db_table_size: dbStats[0]?.size ?? "unknown",
      query_time_ms: Date.now() - queryStart,
    },
  });
});

export default router;
