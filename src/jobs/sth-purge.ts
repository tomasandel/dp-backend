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
    const result = await prisma.sth.deleteMany({
      where: { storedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      console.log(`[Purge] Deleted ${result.count} STHs older than ${cutoff.toISOString()}`);
    }
  } catch (err) {
    console.error("[Purge] Failed to purge stale STHs:", err);
  }
}
