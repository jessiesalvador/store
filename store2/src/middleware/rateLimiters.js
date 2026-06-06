const rateLimit = require("express-rate-limit");
const { FirestoreRateLimitStore } = require("../services/firestoreRateLimitStore");

function rateLimitStore(prefix) {
  if (process.env.RATE_LIMIT_STORE === "memory") return undefined;
  return new FirestoreRateLimitStore({ prefix });
}

function createRateLimiter(prefix, options) {
  return rateLimit({
    ...options,
    store: rateLimitStore(prefix),
  });
}

module.exports = { createRateLimiter };
