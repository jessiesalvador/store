const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["super-admin", "store-admin"],
      required: true,
    },
    // Only relevant for store-admin role
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
    },
    // Forces password change on next login (temp passwords)
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    passwordResetTokenHash: {
      type: String,
      default: null,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash")) return next();
  // passwordHash field holds the plaintext until this hook hashes it
  this.passwordHash = await bcrypt.hash(this.passwordHash, SALT_ROUNDS);
  next();
});

userSchema.index(
  { storeId: 1 },
  {
    unique: true,
    partialFilterExpression: { role: "store-admin", storeId: { $type: "objectId" } },
  }
);

// Compare a plaintext candidate against the stored hash
userSchema.methods.verifyPassword = function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

// Never send the hash to the client
userSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
