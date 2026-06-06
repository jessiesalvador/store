const express = require("express");
const { requireStoreAdmin, requireStoreOwnership } = require("../middleware/guards");
const { upload } = require("../middleware/upload");
const { col, createDoc, db, deleteDoc, getById, now, updateDoc, withId } = require("../utils/firestoreData");
const { DEFAULT_PHOTO, deleteStoredPhoto, preparePhotoInput, uploadItemPhoto, uploadPhotoInput } = require("../services/photoStorage");

const router = express.Router({ mergeParams: true }); // inherits :storeId from parent

function cleanItemInput(item, index) {
  const name = String(item?.name || "").trim();
  const category = String(item?.category || "").trim();
  const price = Number(item?.price);

  if (!name || !category || !Number.isFinite(price) || price <= 0) {
    throw Object.assign(new Error(`Item ${index + 1} must include a name, category, and valid price.`), {
      status: 400,
    });
  }

  return {
    name: name.slice(0, 120),
    category: category.slice(0, 60),
    price,
  };
}

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

      const store = await getById("stores", req.params.storeId);
      if (!store) return res.status(404).json({ error: "Store not found." });
      if (!store.categories.includes(category)) {
        return res.status(400).json({ error: `"${category}" is not a valid category for this store.` });
      }

      const photoInput = preparePhotoInput({
        file: req.file,
        photoDataUrl: req.body.photoDataUrl,
        photoUrl: req.body.photoUrl,
      });

      const item = await createDoc("items", {
        storeId: req.params.storeId,
        name,
        category,
        price: Number(price),
        photo: DEFAULT_PHOTO,
        photoStoragePath: null,
        soldOut: false,
        ...(photoInput?.fields || {}),
      });

      if (photoInput?.upload) {
        uploadItemPhoto({ storeId: req.params.storeId, itemId: item._id, ...photoInput.upload })
          .then((uploaded) => updateDoc("items", item._id, uploaded))
          .catch((err) => console.error("Item photo upload failed:", err));
      }

      res.status(201).json({ item });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/stores/:storeId/items/bulk — add many items ───────────────────
router.post("/bulk", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    if (!Array.isArray(req.body.items)) {
      return res.status(400).json({ error: "items must be an array." });
    }
    if (!req.body.items.length) {
      return res.status(400).json({ error: "Add at least one item." });
    }
    if (req.body.items.length > 300) {
      return res.status(400).json({ error: "Upload 300 items or fewer at a time." });
    }

    const items = req.body.items.map(cleanItemInput);
    let created = [];
    let categories = [];

    await db.runTransaction(async (transaction) => {
      const storeRef = col("stores").doc(req.params.storeId);
      const storeSnap = await transaction.get(storeRef);
      if (!storeSnap.exists) {
        throw Object.assign(new Error("Store not found."), { status: 404 });
      }

      const store = storeSnap.data();
      const timestamp = now();
      categories = [...(store.categories || [])];
      const categorySet = new Set(categories);

      items.forEach((item) => {
        if (!categorySet.has(item.category)) {
          categorySet.add(item.category);
          categories.push(item.category);
        }
      });

      if (categories.length !== (store.categories || []).length) {
        transaction.update(storeRef, { categories, updatedAt: timestamp });
      }

      created = items.map((item) => {
        const ref = col("items").doc();
        const payload = {
          storeId: req.params.storeId,
          name: item.name,
          category: item.category,
          price: item.price,
          photo: DEFAULT_PHOTO,
          soldOut: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        transaction.set(ref, payload);
        return withId(ref.id, payload);
      });
    });

    res.status(201).json({ items: created, categories });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/stores/:storeId/items/:itemId/photo — replace item photo ──────
router.post(
  "/:itemId/photo",
  requireStoreAdmin,
  requireStoreOwnership,
  async (req, res, next) => {
    try {
      const item = await getById("items", req.params.itemId);
      if (item?.storeId !== req.params.storeId) return res.status(404).json({ error: "Item not found." });
      if (!item) return res.status(404).json({ error: "Item not found." });
      const uploaded = await uploadPhotoInput({
        storeId: req.params.storeId,
        itemId: req.params.itemId,
        photoDataUrl: req.body.photoDataUrl,
        photoUrl: req.body.photoUrl,
      });
      if (!uploaded) return res.status(400).json({ error: "Photo is required." });

      await deleteStoredPhoto(item);
      res.json({ item: await updateDoc("items", req.params.itemId, uploaded, { base: item }) });
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
      const item = await getById("items", req.params.itemId);
      if (item?.storeId !== req.params.storeId) return res.status(404).json({ error: "Item not found." });
      if (!item) return res.status(404).json({ error: "Item not found." });

      const updates = {};
      if (req.body.name !== undefined) {
        const name = String(req.body.name || "").trim();
        if (!name) return res.status(400).json({ error: "Item name is required." });
        updates.name = name.slice(0, 120);
      }
      if (req.body.category !== undefined) {
        const category = String(req.body.category || "").trim();
        if (!category) return res.status(400).json({ error: "Category is required." });

        const store = await getById("stores", req.params.storeId);
        if (!store) return res.status(404).json({ error: "Store not found." });
        if (!store.categories.includes(category)) {
          return res.status(400).json({ error: `"${category}" is not a valid category for this store.` });
        }
        updates.category = category;
      }
      if (req.body.price !== undefined) {
        const price = Number(req.body.price);
        if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "Price must be greater than 0." });
        updates.price = price;
      }
      if (req.body.soldOut !== undefined) updates.soldOut = req.body.soldOut === "true" || req.body.soldOut === true;
      if (req.file) {
        Object.assign(
          updates,
          await uploadPhotoInput({
            storeId: req.params.storeId,
            itemId: req.params.itemId,
            file: req.file,
          })
        );
        await deleteStoredPhoto(item);
      }

      res.json({ item: await updateDoc("items", req.params.itemId, updates, { base: item }) });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/stores/:storeId/items/:itemId ────────────────────────────────
router.delete("/:itemId", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const item = await getById("items", req.params.itemId);
    if (item?.storeId !== req.params.storeId) return res.status(404).json({ error: "Item not found." });
    if (!item) return res.status(404).json({ error: "Item not found." });
    await deleteDoc("items", req.params.itemId);
    await deleteStoredPhoto(item);
    res.json({ message: "Item deleted." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
