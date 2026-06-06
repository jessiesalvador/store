const express = require("express");
const crypto = require("crypto");
const { requireStoreAdmin, requireStoreOwnership } = require("../middleware/guards");
const { createRateLimiter } = require("../middleware/rateLimiters");
const { sendOrderNotification, sendOrderOtpEmail } = require("../services/emailService");
const { col, createDoc, fromQuery, getById, updateDoc } = require("../utils/firestoreData");

const router = express.Router({ mergeParams: true }); // inherits :storeId
const MAX_QUANTITY_PER_ITEM = 99;
const OTP_TTL_MS = 10 * 60 * 1000;
const ORDER_TOKEN_TTL_MS = 15 * 60 * 1000;

const publicOrderLimiter = createRateLimiter("orders-public", {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many orders from this connection. Please try again soon." },
});

const otpLimiter = createRateLimiter("orders-otp", {
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification requests. Please try again soon." },
});

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function withOrderStatus(order) {
  return order ? { ...order, status: order.readAt ? "Read" : "Unread" } : order;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function makeOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function makeOrderToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function validateOrderEmailToken(storeId, email, token) {
  if (!token) return null;
  const tokenHash = hashSecret(token);
  const record = fromQuery(
    await col("orderEmailOtps")
      .where("storeId", "==", storeId)
      .where("email", "==", email)
      .where("tokenHash", "==", tokenHash)
      .where("tokenExpiresAt", ">", new Date())
      .orderBy("tokenExpiresAt", "asc")
      .limit(1)
      .get()
  )[0];
  if (!record || record.usedAt) return null;
  return record;
}

// ─── POST /api/stores/:storeId/orders/otp/start — send customer OTP ──────────
router.post("/otp/start", otpLimiter, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 180).toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required." });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const store = await getById("stores", req.params.storeId);
    if (!store || !store.approved) return res.status(404).json({ error: "Store not found." });
    if (!store.orderEmailOtpRequired) {
      return res.status(400).json({ error: "Email verification is not required for this store." });
    }

    const code = makeOtpCode();
    const otp = await createDoc("orderEmailOtps", {
      storeId: req.params.storeId,
      email,
      codeHash: hashSecret(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 0,
    });

    await sendOrderOtpEmail(email, store.name, code);
    res.json({
      otpId: otp._id,
      expiresAt: otp.expiresAt,
      message: "Verification code sent.",
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/stores/:storeId/orders/otp/verify — verify customer OTP ───────
router.post("/otp/verify", otpLimiter, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 180).toLowerCase();
    const code = cleanText(req.body.code, 12).replace(/\s+/g, "");
    const otpId = cleanText(req.body.otpId, 120);

    if (!otpId || !email || !code) return res.status(400).json({ error: "Email and verification code are required." });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const otp = await getById("orderEmailOtps", otpId);
    if (!otp || otp.storeId !== req.params.storeId || otp.email !== email) {
      return res.status(400).json({ error: "Invalid verification code." });
    }
    if (otp.usedAt || !otp.expiresAt || new Date(otp.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "Verification code expired. Please request a new code." });
    }
    if (Number(otp.attempts || 0) >= 5) {
      return res.status(429).json({ error: "Too many attempts. Please request a new code." });
    }

    if (otp.codeHash !== hashSecret(code)) {
      await updateDoc("orderEmailOtps", otpId, { attempts: Number(otp.attempts || 0) + 1 });
      return res.status(400).json({ error: "Invalid verification code." });
    }

    const token = makeOrderToken();
    await updateDoc("orderEmailOtps", otpId, {
      verifiedAt: new Date(),
      tokenHash: hashSecret(token),
      tokenExpiresAt: new Date(Date.now() + ORDER_TOKEN_TTL_MS),
    });

    res.json({
      emailVerificationToken: token,
      expiresAt: new Date(Date.now() + ORDER_TOKEN_TTL_MS),
      message: "Email verified.",
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/stores/:storeId/orders — customer places an order (public) ────
router.post("/", publicOrderLimiter, async (req, res, next) => {
  try {
    const { cart, customer = {}, emailVerificationToken } = req.body;
    // cart = { itemId: quantity, ... }
    if (!cart || typeof cart !== "object" || !Object.keys(cart).length) {
      return res.status(400).json({ error: "Cart is empty." });
    }

    const customerDetails = {
      name: cleanText(customer.name, 120),
      email: cleanText(customer.email, 180).toLowerCase(),
      phone: cleanText(customer.phone, 40),
      note: cleanText(customer.note, 500),
    };

    if (!customerDetails.email) {
      return res.status(400).json({ error: "Email is required to send an order." });
    }
    if (!isValidEmail(customerDetails.email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const store = await getById("stores", req.params.storeId);
    if (!store || !store.approved) {
      return res.status(404).json({ error: "Store not found." });
    }

    let verifiedEmailRecord = null;
    if (store.orderEmailOtpRequired) {
      verifiedEmailRecord = await validateOrderEmailToken(req.params.storeId, customerDetails.email, emailVerificationToken);
      if (!verifiedEmailRecord) {
        return res.status(403).json({ error: "Please verify your email before sending this order." });
      }
    }

    const itemIds = Object.keys(cart);
    const itemRefs = itemIds.map((id) => col("items").doc(id));
    const itemSnaps = itemRefs.length ? await col("items").firestore.getAll(...itemRefs) : [];
    const items = itemSnaps
      .filter((snap) => snap.exists)
      .map((snap) => ({ _id: snap.id, id: snap.id, ...snap.data() }))
      .filter((item) => item.storeId === req.params.storeId);

    if (!items.length) {
      return res.status(400).json({ error: "No valid items found in cart." });
    }

    const lineItems = [];
    let total = 0;

    for (const item of items) {
      if (item.soldOut) continue; // silently skip sold-out items
      const requestedQty = Math.floor(Number(cart[item._id.toString()]));
      if (!Number.isFinite(requestedQty) || requestedQty < 1) continue;
      const qty = Math.min(requestedQty, MAX_QUANTITY_PER_ITEM);
      const lineTotal = Math.round(item.price * qty * 100) / 100;
      lineItems.push({
        itemId: item._id,
        name: item.name,
        quantity: qty,
        unitPrice: item.price,
        lineTotal,
      });
      total += lineTotal;
    }

    if (!lineItems.length) {
      return res.status(400).json({ error: "All items in the cart are sold out." });
    }

    total = Math.round(total * 100) / 100;

    const order = await createDoc("orders", {
      storeId: store._id,
      storeName: store.name,
      recipientEmail: store.ownerEmail,
      customer: customerDetails,
      items: lineItems,
      total,
      archived: false,
      emailVerifiedAt: verifiedEmailRecord ? new Date() : undefined,
    });

    if (verifiedEmailRecord) {
      await updateDoc("orderEmailOtps", verifiedEmailRecord._id, { usedAt: new Date(), orderId: order._id });
    }

    // Email the store admin — fire-and-forget so the customer doesn't wait
    sendOrderNotification(withOrderStatus(order), store.ownerEmail).catch(console.error);

    res.status(201).json({ order: withOrderStatus(order) });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/stores/:storeId/orders — admin lists orders ────────────────────
router.get("/", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const { archived } = req.query;
    let query = col("orders").where("storeId", "==", req.params.storeId);
    if (archived !== undefined) query = query.where("archived", "==", archived === "true");
    query = query.orderBy("createdAt", "desc");

    const orders = fromQuery(await query.get()).map(withOrderStatus);
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/stores/:storeId/orders/:orderId — mark read / update status ──
router.patch("/:orderId", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const order = await getById("orders", req.params.orderId);
    if (order?.storeId !== req.params.storeId) return res.status(404).json({ error: "Order not found." });
    if (!order) return res.status(404).json({ error: "Order not found." });

    const VALID_STATUSES = ["New", "Preparing", "Ready", "Fulfilled"];
    const updates = {};

    if (req.body.orderStatus && VALID_STATUSES.includes(req.body.orderStatus)) {
      updates.orderStatus = req.body.orderStatus;
    }
    if (req.body.markRead && !order.readAt) {
      updates.readAt = new Date();
    }
    if (req.body.archived !== undefined) {
      updates.archived = Boolean(req.body.archived);
    }

    res.json({ order: withOrderStatus(await updateDoc("orders", req.params.orderId, updates, { base: order })) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
