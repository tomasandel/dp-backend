import prisma from "../prisma";

const PURGE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // run every hour

export function startSthPurgeJob() {
  console.log("[Purge] STH purge job started (max age: 48h, interval: 1h)");
  // Run once at startup, then every hour
  purgeStaleSTHs();
  setInterval(purgeStaleSTHs, PURGE_INTERVAL_MS);
}

async function purgeStaleSTHs() {
  const cutoff = new Date(Date.now() - PURGE_MAX_AGE_MS);
  try {
    // Get all distinct log IDs that have STHs
    const logs = await prisma.sth.groupBy({ by: ["logId"] });

    // For each log, find the newest STH id to keep
    const keepIds: number[] = [];
    for (const { logId } of logs) {
      const newest = await prisma.sth.findFirst({
        where: { logId },
        orderBy: { storedAt: "desc" },
        select: { id: true },
      });
      if (newest) keepIds.push(newest.id);
    }

    const result = await prisma.sth.deleteMany({
      where: {
        storedAt: { lt: cutoff },
        ...(keepIds.length > 0 && { id: { notIn: keepIds } }),
      },
    });
    if (result.count > 0) {
      console.log(
        `[Purge] Deleted ${result.count} STHs older than ${cutoff.toISOString()} (kept ${keepIds.length} newest per log)`
      );
    }
  } catch (err) {
    console.error("[Purge] Failed to purge stale STHs:", err);
  }
}
