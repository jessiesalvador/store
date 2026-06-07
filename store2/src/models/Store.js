const mongoose = require("mongoose");

const heroSchema = new mongoose.Schema(
  {
    eyebrow: { type: String, default: "", trim: true },
    headline: { type: String, default: "", trim: true },
    subheading: { type: String, default: "", trim: true },
    detail: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    // Denormalised for quick hero/email display — source of truth is User.storeId
    ownerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    categories: {
      type: [String],
      default: ["Produce"],
    },
    hero: {
      type: heroSchema,
      default: () => ({}),
    },
    approved: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Store", storeSchema);
