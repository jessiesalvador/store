const { db } = require("../config/firebase");

function col(name) {
  return db.collection(name);
}

function now() {
  return new Date();
}

function cleanDoc(data) {
  const output = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) output[key] = value;
  });
  return output;
}

function fromSnap(snap) {
  if (!snap.exists) return null;
  return withId(snap.id, snap.data());
}

function fromQuery(snap) {
  return snap.docs.map(fromSnap);
}

function withId(id, data) {
  return normalizeDates({ _id: id, id, ...data });
}

function normalizeDates(value) {
  if (!value) return value;
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDates(item)]));
  }
  return value;
}

async function getById(collection, id) {
  return fromSnap(await col(collection).doc(id).get());
}

async function createDoc(collection, data, id) {
  const ref = id ? col(collection).doc(id) : col(collection).doc();
  const timestamp = now();
  const payload = cleanDoc({ ...data, createdAt: data.createdAt || timestamp, updatedAt: data.updatedAt || timestamp });
  await ref.set(payload);
  return withId(ref.id, payload);
}

function isMissingDocumentError(err) {
  return err?.code === 5 || err?.code === "not-found" || /no document to update/i.test(String(err?.message || ""));
}

async function updateDoc(collection, id, updates, options = {}) {
  const ref = col(collection).doc(id);
  const payload = cleanDoc({ ...updates, updatedAt: now() });

  try {
    await ref.update(payload);
  } catch (err) {
    if (isMissingDocumentError(err)) return null;
    throw err;
  }

  if (options.readAfter) return fromSnap(await ref.get());
  if (options.base) return withId(id, { ...options.base, ...payload });
  return withId(id, payload);
}

async function deleteDoc(collection, id) {
  const ref = col(collection).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.delete();
  return fromSnap(snap);
}

module.exports = {
  db,
  col,
  now,
  cleanDoc,
  fromSnap,
  fromQuery,
  withId,
  getById,
  createDoc,
  updateDoc,
  deleteDoc,
};
