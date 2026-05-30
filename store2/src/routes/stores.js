const express = require("express");
const slugifyLib = require("slugify");
const Store = require("../models/Store");
const Item = require("../models/Item");
const Order = require("../models/Order");
const User = require("../models/User");
const { requireSuperAdmin, requireStoreAdmin, requireStoreOwnership } = require("../middleware/guards");

const router = express.Router();

function makeSlug(name) {
  return slugifyLib(name, { lower: true, strict: true });
}

function cleanHero(input = {}) {
  const fields = ["eyebrow", "headline", "subheading", "detail"];
  const hero = {};
  fields.forEach((field) => {
    if (input[field] !== undefined) {
      hero[field] = String(input[field] || "").trim().slice(0, field === "headline" ? 90 : 180);
    }
  });
  return hero;
}

// ─── GET /api/stores — public list of all approved stores ────────────────────
router.get("/", async (req, res, next) => {
  try {
    const stores = await Store.find({ approved: true }).select("-ownerEmail").sort({ name: 1 });
    res.json({ stores });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/stores/:storeId — single store (public) ────────────────────────
router.get("/:storeId", async (req, res, next) => {
  try {
    const store = await Store.findById(req.params.storeId).select("-ownerEmail");
    if (!store || !store.approved) {
      return res.status(404).json({ error: "Store not found." });
    }
    res.json({ store });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/stores — super admin creates a store ──────────────────────────
router.post("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, location, ownerEmail, categories } = req.body;
    if (!name || !location || !ownerEmail) {
      return res.status(400).json({ error: "name, location and ownerEmail are required." });
    }

    const slug = makeSlug(name);
    const exists = await Store.findOne({ slug });
    if (exists) {
      return res.status(409).json({ error: `A store with the slug "${slug}" already exists.` });
    }

    const store = await Store.create({
      name,
      slug,
      location,
      ownerEmail: ownerEmail.toLowerCase(),
      categories: categories || ["Produce"],
      approved: true,
    });

    res.status(201).json({ store });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/stores/:storeId — update store details ───────────────────────
router.patch("/:storeId", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const allowed = ["name", "location", "categories"];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });
    if (req.body.hero && typeof req.body.hero === "object") {
      updates.hero = cleanHero(req.body.hero);
    }

    // Super admin can also update ownerEmail and public URL slug.
    if (req.session.role === "super-admin" && req.body.ownerEmail) {
      updates.ownerEmail = req.body.ownerEmail.toLowerCase();
    }
    if (req.session.role === "super-admin" && req.body.slug) {
      updates.slug = makeSlug(req.body.slug);
      if (!updates.slug) return res.status(400).json({ error: "slug must contain letters or numbers." });

      const existingSlug = await Store.findOne({
        slug: updates.slug,
        _id: { $ne: req.params.storeId },
      });
      if (existingSlug) {
        return res.status(409).json({ error: `A store with the slug "${updates.slug}" already exists.` });
      }
    }

    if (updates.name && !updates.slug) updates.slug = makeSlug(updates.name);

    const store = await Store.findByIdAndUpdate(req.params.storeId, updates, {
      new: true,
      runValidators: true,
    });
    if (!store) return res.status(404).json({ error: "Store not found." });
    res.json({ store });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/stores/:storeId — super admin only ──────────────────────────
router.delete("/:storeId", requireSuperAdmin, async (req, res, next) => {
  try {
    const store = await Store.findByIdAndDelete(req.params.storeId);
    if (!store) return res.status(404).json({ error: "Store not found." });

    // Cascade delete items, orders, and unlink admins
    await Promise.all([
      Item.deleteMany({ storeId: req.params.storeId }),
      Order.deleteMany({ storeId: req.params.storeId }),
      User.updateMany({ storeId: req.params.storeId }, { $set: { storeId: null } }),
    ]);

    res.json({ message: "Store and all related data deleted." });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/stores/:storeId/items — public item listing ────────────────────
router.get("/:storeId/items", async (req, res, next) => {
  try {
    const { category, sort } = req.query;
    const filter = { storeId: req.params.storeId };
    if (category && category !== "all") filter.category = category;

    const sortMap = {
      "price-asc": { price: 1 },
      "price-desc": { price: -1 },
      "name-asc": { name: 1 },
      "name-desc": { name: -1 },
    };

    const items = await Item.find(filter).sort(sortMap[sort] || { createdAt: -1 });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
