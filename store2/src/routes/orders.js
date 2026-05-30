const express = require("express");
const rateLimit = require("express-rate-limit");
const Order = require("../models/Order");
const Store = require("../models/Store");
const Item = require("../models/Item");
const { requireStoreAdmin, requireStoreOwnership } = require("../middleware/guards");
const { sendOrderNotification } = require("../services/emailService");

const router = express.Router({ mergeParams: true }); // inherits :storeId
const MAX_QUANTITY_PER_ITEM = 99;

const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many orders from this connection. Please try again soon." },
});

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

// ─── POST /api/stores/:storeId/orders — customer places an order (public) ────
router.post("/", publicOrderLimiter, async (req, res, next) => {
  try {
    const { cart, customer = {} } = req.body;
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerDetails.email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const store = await Store.findById(req.params.storeId);
    if (!store || !store.approved) {
      return res.status(404).json({ error: "Store not found." });
    }

    const itemIds = Object.keys(cart);
    const items = await Item.find({ _id: { $in: itemIds }, storeId: req.params.storeId });

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

    const order = await Order.create({
      storeId: store._id,
      storeName: store.name,
      recipientEmail: store.ownerEmail,
      customer: customerDetails,
      items: lineItems,
      total,
    });

    // Email the store admin — fire-and-forget so the customer doesn't wait
    sendOrderNotification(order, store.ownerEmail).catch(console.error);

    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/stores/:storeId/orders — admin lists orders ────────────────────
router.get("/", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const { archived } = req.query;
    const filter = { storeId: req.params.storeId };
    if (archived !== undefined) filter.archived = archived === "true";

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/stores/:storeId/orders/:orderId — mark read / update status ──
router.patch("/:orderId", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      storeId: req.params.storeId,
    });
    if (!order) return res.status(404).json({ error: "Order not found." });

    const VALID_STATUSES = ["New", "Preparing", "Ready", "Fulfilled"];

    if (req.body.orderStatus && VALID_STATUSES.includes(req.body.orderStatus)) {
      order.orderStatus = req.body.orderStatus;
    }
    if (req.body.markRead && !order.readAt) {
      order.readAt = new Date();
    }
    if (req.body.archived !== undefined) {
      order.archived = Boolean(req.body.archived);
    }

    await order.save();
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
