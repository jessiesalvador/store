const express = require("express");
const Item = require("../models/Item");
const Store = require("../models/Store");
const { requireStoreAdmin, requireStoreOwnership } = require("../middleware/guards");
const { upload } = require("../middleware/upload");

const router = express.Router({ mergeParams: true }); // inherits :storeId from parent

const DEFAULT_PHOTO =
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80";

// ─── POST /api/stores/:storeId/items — add an item ───────────────────────────
router.post(
  "/",
  requireStoreAdmin,
  requireStoreOwnership,
  upload.single("photo"),
  async (req, res, next) => {
    try {
      const { name, category, price } = req.body;
      if (!name || !category || !price) {
        return res.status(400).json({ error: "name, category and price are required." });
      }

      const store = await Store.findById(req.params.storeId);
      if (!store) return res.status(404).json({ error: "Store not found." });
      if (!store.categories.includes(category)) {
        return res.status(400).json({ error: `"${category}" is not a valid category for this store.` });
      }

      let photo = DEFAULT_PHOTO;
      if (req.file) {
        const b64 = req.file.buffer.toString("base64");
        photo = `data:${req.file.mimetype};base64,${b64}`;
      }

      const item = await Item.create({
        storeId: req.params.storeId,
        name,
        category,
        price: Number(price),
        photo,
        soldOut: false,
      });

      res.status(201).json({ item });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/stores/:storeId/items/:itemId — update price / sold-out ──────
router.patch(
  "/:itemId",
  requireStoreAdmin,
  requireStoreOwnership,
  upload.single("photo"),
  async (req, res, next) => {
    try {
      const item = await Item.findOne({
        _id: req.params.itemId,
        storeId: req.params.storeId,
      });
      if (!item) return res.status(404).json({ error: "Item not found." });

      if (req.body.price !== undefined) item.price = Number(req.body.price);
      if (req.body.soldOut !== undefined) item.soldOut = req.body.soldOut === "true" || req.body.soldOut === true;
      if (req.file) {
        const b64 = req.file.buffer.toString("base64");
        item.photo = `data:${req.file.mimetype};base64,${b64}`;
      }

      await item.save();
      res.json({ item });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/stores/:storeId/items/bulk-sold-out — bulk toggle ─────────────
router.patch("/bulk-sold-out", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const { soldOut, category } = req.body;
    const filter = { storeId: req.params.storeId };
    if (category && category !== "all") filter.category = category;

    await Item.updateMany(filter, { $set: { soldOut: Boolean(soldOut) } });
    res.json({ message: `Items marked as ${soldOut ? "sold out" : "back in stock"}.` });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/stores/:storeId/items/:itemId ────────────────────────────────
router.delete("/:itemId", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const item = await Item.findOneAndDelete({
      _id: req.params.itemId,
      storeId: req.params.storeId,
    });
    if (!item) return res.status(404).json({ error: "Item not found." });
    res.json({ message: "Item deleted." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;