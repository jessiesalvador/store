const session = require("express-session");
const { db } = require("../config/firebase");

class FirestoreSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.collection = db.collection(options.collection || "sessions");
    this.ttlMs = options.ttlMs || 7 * 24 * 60 * 60 * 1000;
    this.touchIntervalMs = options.touchIntervalMs || Number(process.env.SESSION_TOUCH_INTERVAL_MS) || 5 * 60 * 1000;
  }

  async get(sid, callback) {
    try {
      const snap = await this.collection.doc(sid).get();
      if (!snap.exists) return callback(null, null);

      const data = snap.data();
      const expires = toDate(data.expires);
      if (expires && expires <= new Date()) {
        await this.destroy(sid, () => {});
        return callback(null, null);
      }

      callback(null, data.session ? JSON.parse(data.session) : null);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + this.ttlMs);
      const touchedAt = new Date();
      sess.__lastTouchedAt = touchedAt.getTime();
      await this.collection.doc(sid).set({
        session: JSON.stringify(sess),
        expires,
        touchedAt,
        updatedAt: new Date(),
      });
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback = () => {}) {
    try {
      await this.collection.doc(sid).delete();
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async touch(sid, sess, callback = () => {}) {
    try {
      const currentTouch = Number(sess.__lastTouchedAt || 0);
      const elapsed = Date.now() - currentTouch;
      if (currentTouch && elapsed >= 0 && elapsed < this.touchIntervalMs) {
        return callback(null);
      }

      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + this.ttlMs);
      const ref = this.collection.doc(sid);
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) return;

        const data = snap.data();
        const storedTouch = toDate(data.touchedAt);
        if (storedTouch && Date.now() - storedTouch.getTime() < this.touchIntervalMs) {
          sess.__lastTouchedAt = storedTouch.getTime();
          return;
        }

        const touchedAt = new Date();
        sess.__lastTouchedAt = touchedAt.getTime();
        transaction.set(
          ref,
          {
            session: JSON.stringify(sess),
            expires,
            touchedAt,
            updatedAt: touchedAt,
          },
          { merge: true }
        );
      });
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

module.exports = { FirestoreSessionStore };
