const mongoose = require("mongoose");

const ORDER_STATUSES = ["New", "Preparing", "Ready", "Fulfilled"];

const lineItemSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Item" },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    note: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    storeName: {
      type: String,
      required: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      lowercase: true,
    },
    customer: {
      type: customerSchema,
      default: null,
    },
    items: {
      type: [lineItemSchema],
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    orderStatus: {
      type: String,
      enum: ORDER_STATUSES,
      default: "New",
    },
    // Read / unread tracking
    readAt: {
      type: Date,
      default: null,
    },
    archived: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Virtual — mirrors the old "Unread"/"Read" string the frontend uses
orderSchema.virtual("status").get(function () {
  return this.readAt ? "Read" : "Unread";
});

orderSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Order", orderSchema);
