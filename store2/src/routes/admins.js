const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { requireSuperAdmin } = require("../middleware/guards");
const { sendTempPasswordEmail } = require("../services/emailService");
const { col, createDoc, deleteDoc, fromQuery, getById, updateDoc } = require("../utils/firestoreData");

const router = express.Router();
const SALT_ROUNDS = 12;

function generateTempPassword() {
  return `Temp-${crypto.randomBytes(9).toString("base64url")}`;
}

function withoutPassword(user) {
  if (!user) return null;
  const { passwordHash, passwordResetTokenHash, passwordResetExpiresAt, ...safe } = user;
  return safe;
}

async function findUserByEmail(email) {
  return fromQuery(await col("users").where("email", "==", email).limit(1).get())[0] || null;
}

async function findStoreAdminByStore(storeId, exceptUserId = null) {
  const users = fromQuery(await col("users").where("storeId", "==", storeId).get());
  return users.find((user) => user.role === "store-admin" && user._id !== exceptUserId) || null;
}

async function listAdminsWithStores() {
  const admins = fromQuery(await col("users").where("role", "==", "store-admin").get()).map(withoutPassword);
  const storeIds = [...new Set(admins.map((admin) => admin.storeId).filter(Boolean))];
  const storeMap = new Map();
  if (storeIds.length) {
    const snaps = await col("stores").firestore.getAll(...storeIds.map((id) => col("stores").doc(id)));
    snaps.forEach((snap) => {
      if (snap.exists) storeMap.set(snap.id, { _id: snap.id, id: snap.id, name: snap.data().name, slug: snap.data().slug });
    });
  }
  return admins
    .map((admin) => ({ ...admin, storeId: admin.storeId ? storeMap.get(admin.storeId) || admin.storeId : null }))
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));
}

// ─── GET /api/admins — list all store admins ──────────────────────────────────
router.get("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const admins = await listAdminsWithStores();
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

    const store = await getById("stores", storeId);
    if (!store) return res.status(404).json({ error: "Store not found." });

    const existing = await findUserByEmail(email.toLowerCase());
    if (existing) return res.status(409).json({ error: "An account with this email already exists." });

    const storeOwner = await findStoreAdminByStore(storeId);
    if (storeOwner) return res.status(409).json({ error: "This store already has an admin owner." });

    const tempPassword = generateTempPassword();
    let admin;
    try {
      await col("users").firestore.runTransaction(async (transaction) => {
        const adminRef = col("users").doc();
        admin = {
          _id: adminRef.id,
          id: adminRef.id,
          name,
          email: email.toLowerCase(),
          passwordHash: await bcrypt.hash(tempPassword, SALT_ROUNDS),
          role: "store-admin",
          storeId,
          mustChangePassword: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        transaction.set(adminRef, admin);
        transaction.update(col("stores").doc(storeId), { ownerEmail: email.toLowerCase(), updatedAt: new Date() });
      });

      await sendTempPasswordEmail(admin.email, admin.name, tempPassword, store.name);
    } catch (err) {
      if (admin?._id) {
        await Promise.all([
          deleteDoc("users", admin._id),
          updateDoc("stores", storeId, { ownerEmail: "pending@freshcart.app" }),
        ]);
      }
      throw err;
    }

    res.status(201).json({
      admin: { id: admin._id, name: admin.name, email: admin.email, storeId: admin.storeId },
      emailSent: true,
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

    const store = await getById("stores", storeId);
    if (!store) return res.status(404).json({ error: "Store not found." });

    const storeOwner = await findStoreAdminByStore(storeId, req.params.adminId);
    if (storeOwner) return res.status(409).json({ error: "This store already has an admin owner." });

    const existingAdmin = await getById("users", req.params.adminId);
    if (!existingAdmin || existingAdmin.role !== "store-admin") return res.status(404).json({ error: "Admin not found." });

    const admin = withoutPassword(await updateDoc("users", req.params.adminId, { storeId }, { base: existingAdmin }));
    await updateDoc("stores", storeId, { ownerEmail: admin.email });

    res.json({ admin });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admins/:adminId ──────────────────────────────────────────────
router.delete("/:adminId", requireSuperAdmin, async (req, res, next) => {
  try {
    const admin = await getById("users", req.params.adminId);
    if (admin?.role !== "store-admin") return res.status(404).json({ error: "Admin not found." });
    if (!admin) return res.status(404).json({ error: "Admin not found." });
    await deleteDoc("users", req.params.adminId);

    if (admin.storeId) {
      const replacementOwner = await findStoreAdminByStore(admin.storeId);

      await updateDoc("stores", admin.storeId, {
        ownerEmail: replacementOwner?.email || "pending@freshcart.app",
      });
    }

    res.json({ message: "Admin account deleted and store ownership cleared." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
