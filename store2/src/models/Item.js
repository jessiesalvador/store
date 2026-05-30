const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0.01,
    },
    // Stored as a URL (Unsplash) or a base64 data-URI for uploaded photos
    photo: {
      type: String,
      required: true,
    },
    soldOut: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Item", itemSchema);
