const crypto = require("crypto");
const { db } = require("../config/firebase");

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

class FirestoreRateLimitStore {
  constructor(options = {}) {
    this.collection = db.collection(options.collection || "rateLimits");
    this.prefix = options.prefix || "default";
    this.windowMs = options.windowMs || 60 * 1000;
    this.localKeys = false;
  }

  init(options = {}) {
    this.windowMs = options.windowMs || this.windowMs;
  }

  docId(key) {
    return crypto.createHash("sha256").update(`${this.prefix}:${key}`).digest("hex");
  }

  refForKey(key) {
    return this.collection.doc(this.docId(key));
  }

  async get(key) {
    const snap = await this.refForKey(key).get();
    if (!snap.exists) return undefined;

    const data = snap.data();
    const resetTime = toDate(data.expiresAt);
    if (resetTime && resetTime <= new Date()) return undefined;
    return { totalHits: Number(data.totalHits || 0), resetTime };
  }

  async increment(key) {
    const ref = this.refForKey(key);
    let result;

    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = new Date();
      const data = snap.exists ? snap.data() : null;
      const existingReset = toDate(data?.expiresAt);
      const shouldReset = !data || !existingReset || existingReset <= current;
      const resetTime = shouldReset ? new Date(current.getTime() + this.windowMs) : existingReset;
      const totalHits = shouldReset ? 1 : Number(data.totalHits || 0) + 1;

      transaction.set(
        ref,
        {
          prefix: this.prefix,
          totalHits,
          expiresAt: resetTime,
          updatedAt: current,
        },
        { merge: true }
      );

      result = { totalHits, resetTime };
    });

    return result;
  }

  async decrement(key) {
    const ref = this.refForKey(key);
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return;

      const data = snap.data();
      const resetTime = toDate(data.expiresAt);
      if (resetTime && resetTime <= new Date()) {
        transaction.delete(ref);
        return;
      }

      transaction.update(ref, {
        totalHits: Math.max(0, Number(data.totalHits || 0) - 1),
        updatedAt: new Date(),
      });
    });
  }

  async resetKey(key) {
    await this.refForKey(key).delete();
  }

  async resetAll() {
    const snap = await this.collection.where("prefix", "==", this.prefix).get();
    let batch = db.batch();
    let pending = 0;

    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      pending += 1;
      if (pending >= 450) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending) await batch.commit();
  }

  shutdown() {}
}

module.exports = { FirestoreRateLimitStore };
