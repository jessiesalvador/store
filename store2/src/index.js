require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const { connectDB } = require("./config/db");
const { errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth");
const storeRoutes = require("./routes/stores");
const itemRoutes = require("./routes/items");
const orderRoutes = require("./routes/orders");
const adminRoutes = require("./routes/admins");
const storeRequestRoutes = require("./routes/storeRequests");

const app = express();
const PORT = process.env.PORT || 3000;
const frontendDir = path.join(__dirname, "../../store");

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
      },
    },
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Dev: allow any localhost/127.0.0.1 origin (Live Server uses random ports).
// Prod: lock to CLIENT_URL only.
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // curl, Postman, server-to-server
      if (process.env.NODE_ENV !== "production" && localhostPattern.test(origin)) {
        return callback(null, true);
      }
      if (origin === process.env.CLIENT_URL) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" is not allowed.`));
    },
    credentials: true,
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" })); // 10 mb allows base64 photo uploads
app.use(express.urlencoded({ extended: true }));

// ─── Global rate limit — 200 req / 15 min per IP ─────────────────────────────
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
  })
);

// ─── Sessions stored in MongoDB ───────────────────────────────────────────────
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      ttl: 7 * 24 * 60 * 60, // 7 days
      touchAfter: 24 * 3600,  // only update session once per day unless data changes
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ─── Same-origin frontend hosting ────────────────────────────────────────────
app.use(express.static(frontendDir));
app.get("/", (_req, res) => res.sendFile(path.join(frontendDir, "store.html")));
app.get("/store", (_req, res) => res.sendFile(path.join(frontendDir, "store.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(frontendDir, "admin.html")));
app.get("/super-admin", (_req, res) => res.sendFile(path.join(frontendDir, "super-admin.html")));

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
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FreshCart API running → http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
