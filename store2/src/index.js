const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const fs = require("fs");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const { errorHandler } = require("./middleware/errorHandler");
const { createRateLimiter } = require("./middleware/rateLimiters");
const { FirestoreSessionStore } = require("./services/firestoreSessionStore");

const authRoutes = require("./routes/auth");
const storeRoutes = require("./routes/stores");
const itemRoutes = require("./routes/items");
const orderRoutes = require("./routes/orders");
const adminRoutes = require("./routes/admins");
const storeRequestRoutes = require("./routes/storeRequests");

const app = express();
const PORT = process.env.PORT || 3000;
const frontendDir = path.join(__dirname, "../../store");
const frontendEntry = path.join(frontendDir, "store.html");
const hasBundledFrontend = fs.existsSync(frontendEntry);
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
let sessionMiddleware;

// Render terminates HTTPS before requests reach Express. Trusting the first
// proxy lets secure cookies work correctly in production.
app.set("trust proxy", 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
      },
    },
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Dev: allow any localhost/127.0.0.1 origin (Live Server uses random ports).
// Prod: lock to CLIENT_URL only.
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "jsstore-b6d73";
const allowedOrigins = new Set([
  `https://${projectId}.web.app`,
  `https://${projectId}.firebaseapp.com`,
  process.env.CLIENT_URL,
].filter(Boolean));

app.use(
  cors((req, callback) => {
    callback(null, {
      origin(origin, callback) {
        if (!origin) return callback(null, true); // curl, Postman, server-to-server
        if (process.env.NODE_ENV !== "production" && localhostPattern.test(origin)) {
          return callback(null, true);
        }
        if (origin === `${req.protocol}://${req.get("host")}`) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        callback(new Error(`CORS: origin "${origin}" is not allowed.`));
      },
      credentials: true,
    });
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" })); // 10 mb allows base64 photo uploads
app.use(express.urlencoded({ extended: true }));

// ─── API rate limit — 200 req / 15 min per IP ────────────────────────────────
app.use(
  "/api",
  createRateLimiter("api-global", {
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
  })
);

// ─── Sessions stored in Firestore ─────────────────────────────────────────────
function getSessionMiddleware() {
  if (!sessionMiddleware) {
    const sessionOptions = {
      secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
      store: new FirestoreSessionStore(),
    };

    sessionMiddleware = session({
      name: "__session",
      ...sessionOptions,
    });
  }

  return sessionMiddleware;
}

app.use((req, res, next) => getSessionMiddleware()(req, res, next));

// ─── Same-origin frontend hosting ────────────────────────────────────────────
if (hasBundledFrontend) {
  app.use(express.static(frontendDir));
  app.get("/", (_req, res) => res.sendFile(frontendEntry));
  app.get("/store", (_req, res) => res.sendFile(frontendEntry));
  app.get("/admin", (_req, res) => res.sendFile(path.join(frontendDir, "admin.html")));
  app.get("/super-admin", (_req, res) => res.sendFile(path.join(frontendDir, "super-admin.html")));
} else {
  app.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "FreshCart API",
      health: "/api/health",
      app: "https://jsstore-b6d73.web.app",
    });
  });
}

// ─── CSRF protection for cookie-auth and public form posts ───────────────────
app.use((req, res, next) => {
  if (!req.session) return next();
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const token = req.get("x-csrf-token");
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "Invalid or missing CSRF token." });
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/stores/:storeId/items", itemRoutes);
app.use("/api/stores/:storeId/orders", orderRoutes);
app.use("/api/admins", adminRoutes);
app.use("/api/store-requests", storeRequestRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Route not found." }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FreshCart API running -> http://localhost:${PORT}`);
  });
}

function handleApi(req, res) {
  return app(req, res);
}

const api = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    secrets: [anthropicApiKey],
  },
  handleApi
);

const apiAu = onRequest(
  {
    region: process.env.FUNCTION_REGION || "australia-southeast1",
    invoker: "public",
    secrets: [anthropicApiKey],
  },
  handleApi
);

module.exports = { app, api, apiAu };
