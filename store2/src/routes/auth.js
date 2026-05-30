const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { requireAuth } = require("../middleware/guards");
const { sendPasswordChangedEmail, sendPasswordResetEmail } = require("../services/emailService");

const router = express.Router();

// Strict rate limit on login — 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset attempts. Please try again later." },
});

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function clientBaseUrl(req) {
  return process.env.CLIENT_URL || `${req.protocol}://${req.get("host")}`;
}

// ─── GET /api/auth/csrf ───────────────────────────────────────────────────────
router.get("/csrf", (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !(await user.verifyPassword(password))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Regenerate session to prevent fixation attacks
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      req.session.userId = user._id.toString();
      req.session.role = user.role;
      req.session.storeId = user.storeId?.toString() || null;
      req.session.mustChangePassword = user.mustChangePassword;

      res.json({
        csrfToken: req.session.csrfToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          storeId: user.storeId,
          mustChangePassword: user.mustChangePassword,
        },
      });
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out." });
  });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post("/forgot-password", passwordResetLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required." });

    const user = await User.findOne({ email });
    if (user) {
      const token = crypto.randomBytes(32).toString("base64url");
      user.passwordResetTokenHash = hashResetToken(token);
      user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();

      const page = user.role === "super-admin" ? "super-admin" : "admin";
      const resetUrl = `${clientBaseUrl(req)}/${page}?resetToken=${encodeURIComponent(token)}`;
      sendPasswordResetEmail(user.email, user.name, resetUrl).catch(console.error);
    }

    res.json({ message: "If that email exists, a password reset link has been sent." });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post("/reset-password", passwordResetLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Reset token and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const user = await User.findOne({
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ error: "Reset link is invalid or expired." });

    if (await user.verifyPassword(newPassword)) {
      return res.status(400).json({ error: "New password must be different from the current password." });
    }

    user.passwordHash = newPassword;
    user.mustChangePassword = false;
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    await user.save();

    sendPasswordChangedEmail(user.email, user.name).catch(console.error);
    res.json({ message: "Password changed successfully. You can now sign in." });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me — restore session on page load ─────────────────────────
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId).select("-passwordHash");
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: "New password is required." });
    }
    if (!req.session.mustChangePassword && !currentPassword) {
      return res.status(400).json({ error: "Current password is required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    if (currentPassword && !(await user.verifyPassword(currentPassword))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (await user.verifyPassword(newPassword)) {
      return res.status(400).json({ error: "New password must be different from the current password." });
    }

    // The pre-save hook will hash this before writing
    user.passwordHash = newPassword;
    user.mustChangePassword = false;
    await user.save();

    // Update session flag
    req.session.mustChangePassword = false;

    // Fire-and-forget confirmation email
    sendPasswordChangedEmail(user.email, user.name).catch(console.error);

    res.json({ message: "Password changed successfully." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
