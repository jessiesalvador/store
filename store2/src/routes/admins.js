const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");
const Store = require("../models/Store");
const { requireSuperAdmin } = require("../middleware/guards");
const { sendTempPasswordEmail } = require("../services/emailService");

const router = express.Router();

function generateTempPassword() {
  return `Temp-${crypto.randomBytes(9).toString("base64url")}`;
}

// ─── GET /api/admins — list all store admins ──────────────────────────────────
router.get("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const admins = await User.find({ role: "store-admin" })
      .select("-passwordHash")
      .populate("storeId", "name slug");
    res.json({ admins });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admins — create a store admin with temp password ───────────────
router.post("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, email, storeId } = req.body;
    if (!name || !email || !storeId) {
      return res.status(400).json({ error: "name, email and storeId are required." });
    }

    const store = await Store.findById(storeId);
    if (!store) return res.status(404).json({ error: "Store not found." });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: "An account with this email already exists." });

    const storeOwner = await User.findOne({ role: "store-admin", storeId });
    if (storeOwner) return res.status(409).json({ error: "This store already has an admin owner." });

    const tempPassword = generateTempPassword();

    // passwordHash field holds plaintext here — the pre-save hook hashes it
    const admin = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash: tempPassword,
      role: "store-admin",
      storeId,
      mustChangePassword: true,
    });

    // Update denormalised ownerEmail on the store
    store.ownerEmail = email.toLowerCase();
    await store.save();

    // Email the temp password — fire-and-forget
    sendTempPasswordEmail(admin.email, admin.name, tempPassword, store.name).catch(console.error);

    res.status(201).json({
      admin: { id: admin._id, name: admin.name, email: admin.email, storeId: admin.storeId },
      message: `Temporary password emailed to ${admin.email}.`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admins/:adminId — reassign admin to a different store ─────────
router.patch("/:adminId", requireSuperAdmin, async (req, res, next) => {
  try {
    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ error: "storeId is required." });

    const store = await Store.findById(storeId);
    if (!store) return res.status(404).json({ error: "Store not found." });

    const storeOwner = await User.findOne({
      role: "store-admin",
      storeId,
      _id: { $ne: req.params.adminId },
    });
    if (storeOwner) return res.status(409).json({ error: "This store already has an admin owner." });

    const admin = await User.findOneAndUpdate(
      { _id: req.params.adminId, role: "store-admin" },
      { storeId },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!admin) return res.status(404).json({ error: "Admin not found." });

    store.ownerEmail = admin.email;
    await store.save();

    res.json({ admin });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admins/:adminId ──────────────────────────────────────────────
router.delete("/:adminId", requireSuperAdmin, async (req, res, next) => {
  try {
    const admin = await User.findByIdAndDelete(req.params.adminId);
    if (!admin) return res.status(404).json({ error: "Admin not found." });
    res.json({ message: "Admin account deleted." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
