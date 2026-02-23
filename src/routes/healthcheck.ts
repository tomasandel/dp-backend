import { Router } from "express";

const router = Router();

/**
 * @openapi
 * /api/healthcheck:
 *   get:
 *     summary: Health check
 *     description: Returns the health status of the API
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
