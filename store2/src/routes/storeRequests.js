const express = require("express");
const crypto = require("crypto");
const slugifyLib = require("slugify");
const bcrypt = require("bcryptjs");
const { requireSuperAdmin } = require("../middleware/guards");
const {
  sendStoreRequestConfirmation,
  sendStoreApprovedEmail,
} = require("../services/emailService");
const { col, createDoc, fromQuery, getById, updateDoc } = require("../utils/firestoreData");

const router = express.Router();
const SALT_ROUNDS = 12;

function generateTempPassword() {
  return `Temp-${crypto.randomBytes(9).toString("base64url")}`;
}

async function findUserByEmail(email) {
  return fromQuery(await col("users").where("email", "==", email).limit(1).get())[0] || null;
}

// ─── POST /api/store-requests — anyone submits a request ─────────────────────
router.post("/", async (req, res, next) => {
  try {
    const { storeName, ownerName, ownerEmail, message } = req.body;
    if (!storeName || !ownerName || !ownerEmail) {
      return res.status(400).json({ error: "storeName, ownerName and ownerEmail are required." });
    }

    const request = await createDoc("storeRequests", {
      storeName,
      ownerName,
      ownerEmail: ownerEmail.toLowerCase(),
      message: message || "",
      status: "pending",
    });

    sendStoreRequestConfirmation(ownerEmail, ownerName, storeName).catch(console.error);

    res.status(201).json({ request, message: "Request submitted. We'll be in touch soon." });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/store-requests — super admin lists all requests ─────────────────
router.get("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const requests = fromQuery(await col("storeRequests").get()).sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/store-requests/:requestId/approve ─────────────────────────────
router.post("/:requestId/approve", requireSuperAdmin, async (req, res, next) => {
  try {
    const request = await getById("storeRequests", req.params.requestId);
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (request.status !== "pending") {
      return res.status(409).json({ error: `Request is already ${request.status}.` });
    }

    const slug = slugifyLib(request.storeName, { lower: true, strict: true });
    const slugExists = fromQuery(await col("stores").where("slug", "==", slug).limit(1).get())[0];
    if (slugExists) {
      return res.status(409).json({ error: `A store with the slug "${slug}" already exists.` });
    }
    const userExists = await findUserByEmail(request.ownerEmail);
    if (userExists) {
      return res.status(409).json({ error: "An account with this owner email already exists." });
    }

    const tempPassword = generateTempPassword();
    let store;

    await col("stores").firestore.runTransaction(async (transaction) => {
      const storeRef = col("stores").doc();
      const userRef = col("users").doc();
      const timestamp = new Date();
      store = {
        _id: storeRef.id,
        id: storeRef.id,
        name: request.storeName,
        slug,
        location: req.body.location || "TBC",
        ownerEmail: request.ownerEmail,
        categories: ["Produce"],
        approved: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      transaction.set(storeRef, store);
      transaction.set(userRef, {
        name: request.ownerName,
        email: request.ownerEmail,
        passwordHash: await bcrypt.hash(tempPassword, SALT_ROUNDS),
        role: "store-admin",
        storeId: storeRef.id,
        mustChangePassword: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.update(col("storeRequests").doc(req.params.requestId), {
        status: "approved",
        updatedAt: timestamp,
      });
    });

    sendStoreApprovedEmail(
      request.ownerEmail,
      request.ownerName,
      request.storeName,
      tempPassword
    ).catch(console.error);

    res.json({ store, message: `Store approved and credentials emailed to ${request.ownerEmail}.` });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/store-requests/:requestId/reject ───────────────────────────────
router.post("/:requestId/reject", requireSuperAdmin, async (req, res, next) => {
  try {
    const request = await updateDoc("storeRequests", req.params.requestId, { status: "rejected" }, { readAfter: true });
    if (!request) return res.status(404).json({ error: "Request not found." });
    res.json({ request, message: "Request rejected." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
