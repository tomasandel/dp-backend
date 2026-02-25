import { Router, Request, Response } from "express";
import prisma from "../prisma";

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     Sth:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         log_id:
 *           type: string
 *           description: Base64-encoded CT log ID
 *           example: "sh4FzIuizYogTodm+Su5iiUgZ2va+nDnsklTLe+LkF4="
 *         tree_size:
 *           type: integer
 *           description: Merkle tree size at time of STH
 *           example: 12345678
 *         root_hash:
 *           type: string
 *           description: Base64-encoded SHA-256 root hash
 *           example: "abc123..."
 *         timestamp:
 *           type: integer
 *           description: STH timestamp (milliseconds since epoch)
 *           example: 1708700000000
 *         monitor_id:
 *           type: string
 *           description: Identifier of the monitor that collected this STH
 *           example: "monitor-a"
 *         stored_at:
 *           type: string
 *           format: date-time
 *           description: When the backend received this STH
 *     CreateSth:
 *       type: object
 *       required:
 *         - log_id
 *         - tree_size
 *         - root_hash
 *         - timestamp
 *         - monitor_id
 *       properties:
 *         log_id:
 *           type: string
 *           example: "sh4FzIuizYogTodm+Su5iiUgZ2va+nDnsklTLe+LkF4="
 *         tree_size:
 *           type: integer
 *           example: 12345678
 *         root_hash:
 *           type: string
 *           example: "abc123..."
 *         timestamp:
 *           type: integer
 *           example: 1708700000000
 *         monitor_id:
 *           type: string
 *           example: "monitor-a"
 *     SthResponse:
 *       type: object
 *       properties:
 *         log_id:
 *           type: string
 *         tree_size:
 *           type: integer
 *         root_hash:
 *           type: string
 *         timestamp:
 *           type: integer
 */

/**
 * @openapi
 * /api/sth:
 *   post:
 *     summary: Ingest STH from monitor sidecar
 *     description: Receives a Signed Tree Head collected by a monitor and stores it in the database.
 *     tags:
 *       - STH
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSth'
 *     responses:
 *       201:
 *         description: STH stored
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Sth'
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized - invalid or missing API key
 */
router.post("/", async (req: Request, res: Response) => {
  const apiKey = process.env.MONITOR_API_KEY;
  if (!apiKey) {
    console.error("[STH] MONITOR_API_KEY not configured");
    res.status(500).json({ error: "MONITOR_API_KEY not configured" });
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${apiKey}`) {
    console.warn(`[STH] unauthorized POST from ${req.ip}`);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { log_id, tree_size, root_hash, timestamp, monitor_id } = req.body;

  if (!log_id || tree_size == null || !root_hash || timestamp == null || !monitor_id) {
    res.status(400).json({ error: "Missing required fields: log_id, tree_size, root_hash, timestamp, monitor_id" });
    return;
  }

  // Normalize log_id to padded base64 (some sources may send unpadded)
  let normalizedLogId = log_id;
  const pad = (4 - (normalizedLogId.length % 4)) % 4;
  if (pad) normalizedLogId += "=".repeat(pad);

  // Skip duplicate STH (same log, same tree_size, same root_hash)
  const existing = await prisma.sth.findFirst({
    where: {
      logId: normalizedLogId,
      treeSize: BigInt(tree_size),
      rootHash: root_hash,
    },
  });

  if (existing) {
    console.log(`[STH] dup ${monitor_id} log=${normalizedLogId.substring(0, 12)}.. size=${tree_size}`);
    res.status(200).json(serializeSth(existing));
    return;
  }

  const sth = await prisma.sth.create({
    data: {
      logId: normalizedLogId,
      treeSize: BigInt(tree_size),
      rootHash: root_hash,
      timestamp: BigInt(timestamp),
      monitorId: monitor_id,
    },
  });

  console.log(`[STH] new ${monitor_id} log=${normalizedLogId.substring(0, 12)}.. size=${tree_size}`);
  res.status(201).json(serializeSth(sth));
});

/**
 * @openapi
 * /api/sth/{logId}:
 *   get:
 *     summary: Get latest STH for a CT log
 *     description: Returns the most recently stored STH for the given log ID. Used by the browser extension for split-world detection.
 *     tags:
 *       - STH
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         description: Base64-encoded CT log ID (URL-encoded)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Latest STH for the log
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SthResponse'
 *       404:
 *         description: No STH found for this log
 */
router.get("/:logId", async (req: Request<{ logId: string }>, res: Response) => {
  let logId = decodeURIComponent(req.params.logId);
  // Normalize to padded base64
  const getPad = (4 - (logId.length % 4)) % 4;
  if (getPad) logId += "=".repeat(getPad);

  const sth = await prisma.sth.findFirst({
    where: { logId },
    orderBy: { storedAt: "desc" },
  });

  if (!sth) {
    console.log(`[STH] GET 404 log=${logId.substring(0, 12)}..`);
    res.status(404).json({ error: "No STH found for this log" });
    return;
  }

  console.log(`[STH] GET 200 log=${logId.substring(0, 12)}.. size=${sth.treeSize}`);
  res.json({
    log_id: sth.logId,
    tree_size: Number(sth.treeSize),
    root_hash: sth.rootHash,
    timestamp: Number(sth.timestamp),
  });
});

/** Serialize BigInt fields to numbers for JSON response */
function serializeSth(sth: { id: number; logId: string; treeSize: bigint; rootHash: string; timestamp: bigint; monitorId: string; storedAt: Date }) {
  return {
    id: sth.id,
    log_id: sth.logId,
    tree_size: Number(sth.treeSize),
    root_hash: sth.rootHash,
    timestamp: Number(sth.timestamp),
    monitor_id: sth.monitorId,
    stored_at: sth.storedAt,
  };
}

export default router;
