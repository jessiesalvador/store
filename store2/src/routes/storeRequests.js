const express = require("express");
const crypto = require("crypto");
const slugifyLib = require("slugify");
const StoreRequest = require("../models/StoreRequest");
const Store = require("../models/Store");
const User = require("../models/User");
const { requireSuperAdmin } = require("../middleware/guards");
const {
  sendStoreRequestConfirmation,
  sendStoreApprovedEmail,
} = require("../services/emailService");

const router = express.Router();

function generateTempPassword() {
  return `Temp-${crypto.randomBytes(9).toString("base64url")}`;
}

// ─── POST /api/store-requests — anyone submits a request ─────────────────────
router.post("/", async (req, res, next) => {
  try {
    const { storeName, ownerName, ownerEmail, message } = req.body;
    if (!storeName || !ownerName || !ownerEmail) {
      return res.status(400).json({ error: "storeName, ownerName and ownerEmail are required." });
    }

    const request = await StoreRequest.create({
      storeName,
      ownerName,
      ownerEmail: ownerEmail.toLowerCase(),
      message: message || "",
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
    const requests = await StoreRequest.find().sort({ createdAt: -1 });
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/store-requests/:requestId/approve ─────────────────────────────
router.post("/:requestId/approve", requireSuperAdmin, async (req, res, next) => {
  try {
    const request = await StoreRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (request.status !== "pending") {
      return res.status(409).json({ error: `Request is already ${request.status}.` });
    }

    const slug = slugifyLib(request.storeName, { lower: true, strict: true });
    const slugExists = await Store.findOne({ slug });
    if (slugExists) {
      return res.status(409).json({ error: `A store with the slug "${slug}" already exists.` });
    }
    const userExists = await User.findOne({ email: request.ownerEmail });
    if (userExists) {
      return res.status(409).json({ error: "An account with this owner email already exists." });
    }

    const tempPassword = generateTempPassword();
    const session = await Store.startSession();
    let store;

    try {
      await session.withTransaction(async () => {
        [store] = await Store.create([{
          name: request.storeName,
          slug,
          location: req.body.location || "TBC",
          ownerEmail: request.ownerEmail,
          categories: ["Produce"],
          approved: true,
        }], { session });

        await User.create([{
          name: request.ownerName,
          email: request.ownerEmail,
          passwordHash: tempPassword,
          role: "store-admin",
          storeId: store._id,
          mustChangePassword: true,
        }], { session });

        request.status = "approved";
        await request.save({ session });
      });
    } finally {
      await session.endSession();
    }

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
    const request = await StoreRequest.findByIdAndUpdate(
      req.params.requestId,
      { status: "rejected" },
      { new: true }
    );
    if (!request) return res.status(404).json({ error: "Request not found." });
    res.json({ request, message: "Request rejected." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
