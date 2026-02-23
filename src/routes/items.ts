import { Router, Request, Response } from "express";
import prisma from "../prisma";

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     Item:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: "Sample item"
 *         created:
 *           type: string
 *           format: date-time
 *           example: "2026-02-19T12:00:00.000Z"
 *     CreateItem:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           example: "New item"
 */

/**
 * @openapi
 * /api/items:
 *   get:
 *     summary: List all items
 *     tags:
 *       - Items
 *     responses:
 *       200:
 *         description: List of items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Item'
 */
router.get("/", async (_req: Request, res: Response) => {
  const items = await prisma.item.findMany({ orderBy: { created: "desc" } });
  res.json(items);
});

/**
 * @openapi
 * /api/items/{id}:
 *   get:
 *     summary: Get item by ID
 *     tags:
 *       - Items
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Item found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Item'
 *       404:
 *         description: Item not found
 */
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const item = await prisma.item.findUnique({
    where: { id: parseInt(req.params.id) },
  });
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

/**
 * @openapi
 * /api/items:
 *   post:
 *     summary: Create a new item
 *     tags:
 *       - Items
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateItem'
 *     responses:
 *       201:
 *         description: Item created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Item'
 */
router.post("/", async (req: Request, res: Response) => {
  const { name } = req.body;
  const item = await prisma.item.create({ data: { name } });
  res.status(201).json(item);
});

/**
 * @openapi
 * /api/items/{id}:
 *   put:
 *     summary: Update an item
 *     tags:
 *       - Items
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateItem'
 *     responses:
 *       200:
 *         description: Item updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Item'
 *       404:
 *         description: Item not found
 */
router.put("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const { name } = req.body;
  try {
    const item = await prisma.item.update({
      where: { id: parseInt(req.params.id) },
      data: { name },
    });
    res.json(item);
  } catch {
    res.status(404).json({ error: "Item not found" });
  }
});

/**
 * @openapi
 * /api/items/{id}:
 *   delete:
 *     summary: Delete an item
 *     tags:
 *       - Items
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Item deleted
 *       404:
 *         description: Item not found
 */
router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await prisma.item.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Item not found" });
  }
});

export default router;
