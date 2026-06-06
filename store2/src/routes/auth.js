const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { requireAuth } = require("../middleware/guards");
const { createRateLimiter } = require("../middleware/rateLimiters");
const { sendPasswordChangedEmail, sendPasswordResetEmail } = require("../services/emailService");
const { col, fromQuery, getById, updateDoc } = require("../utils/firestoreData");

const router = express.Router();
const SALT_ROUNDS = 12;

// Strict rate limit on login — 10 attempts per 15 minutes per IP
const loginLimiter = createRateLimiter("auth-login", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

const passwordResetLimiter = createRateLimiter("auth-password-reset", {
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
  const configuredUrl = (process.env.CLIENT_URL || "").replace(/\/+$/, "");
  const isLocalUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredUrl);

  if (configuredUrl && !(process.env.NODE_ENV === "production" && isLocalUrl)) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV === "production") {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "jsstore-b6d73";
    return `https://${projectId}.web.app`;
  }

  return `${req.protocol}://${req.get("host")}`;
}

async function findUserByEmail(email) {
  const users = fromQuery(await col("users").where("email", "==", email).limit(1).get());
  return users[0] || null;
}

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

function verifyPassword(user, candidate) {
  return bcrypt.compare(candidate, user.passwordHash);
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, passwordResetTokenHash, passwordResetExpiresAt, ...safe } = user;
  return safe;
}

// ─── GET /api/auth/csrf ───────────────────────────────────────────────────────
router.get("/csrf", (req, res) => {
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: "Failed to initialize session." });
    res.json({ csrfToken: req.session.csrfToken });
  });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const user = await findUserByEmail(email.trim().toLowerCase());
    if (!user || !(await verifyPassword(user, password))) {
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

      req.session.save((err) => {
        if (err) return next(err);
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
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("__session");
    res.json({ message: "Logged out." });
  });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post("/forgot-password", passwordResetLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required." });

    const user = await findUserByEmail(email);
    if (user) {
      const token = crypto.randomBytes(32).toString("base64url");
      await updateDoc("users", user._id, {
        passwordResetTokenHash: hashResetToken(token),
        passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

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

    const matches = fromQuery(await col("users").where("passwordResetTokenHash", "==", hashResetToken(token)).limit(1).get());
    const user = matches.find((candidate) => new Date(candidate.passwordResetExpiresAt) > new Date());
    if (!user) return res.status(400).json({ error: "Reset link is invalid or expired." });

    if (await verifyPassword(user, newPassword)) {
      return res.status(400).json({ error: "New password must be different from the current password." });
    }

    await updateDoc("users", user._id, {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    });

    sendPasswordChangedEmail(user.email, user.name).catch(console.error);
    res.json({ message: "Password changed successfully. You can now sign in." });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me — restore session on page load ─────────────────────────
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await getById("users", req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    res.json({ user: publicUser(user) });
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

    const user = await getById("users", req.session.userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    if (currentPassword && !(await verifyPassword(user, currentPassword))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (await verifyPassword(user, newPassword)) {
      return res.status(400).json({ error: "New password must be different from the current password." });
    }

    await updateDoc("users", user._id, {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    });

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
