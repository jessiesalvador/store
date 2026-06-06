require("dotenv").config();

const mongoose = require("mongoose");
const { db } = require("../src/config/firebase");

const User = require("../src/models/User");
const Store = require("../src/models/Store");
const Item = require("../src/models/Item");
const Order = require("../src/models/Order");
const StoreRequest = require("../src/models/StoreRequest");

const collections = [
  { name: "stores", model: Store },
  { name: "users", model: User },
  { name: "items", model: Item },
  { name: "orders", model: Order },
  { name: "storeRequests", model: StoreRequest },
];

const DEFAULT_PHOTO =
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80";
const MAX_FIRESTORE_STRING_BYTES = 900000;

async function migrate() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required for migration.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  for (const { name, model } of collections) {
    const docs = await model.find({}).lean();
    console.log(`Migrating ${docs.length} ${name} documents...`);
    await writeCollection(name, docs.map((doc) => prepareForFirestore(name, normalizeMongoDoc(doc))));
  }

  await mongoose.disconnect();
  console.log("Firestore migration complete.");
  return { migratedCollections: collections.map(({ name }) => name) };
}

async function writeCollection(collectionName, docs) {
  let batch = db.batch();
  let pending = 0;

  for (const doc of docs) {
    const id = doc._id;
    const { _id, id: _ignoredId, __v, ...data } = doc;
    batch.set(db.collection(collectionName).doc(id), removeUndefined(data), { merge: true });
    pending += 1;

    if (pending >= 450) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending) await batch.commit();
}

function normalizeMongoDoc(value) {
  if (value == null) return value;
  if (value instanceof Date) return value;
  if (value._bsontype === "ObjectId") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeMongoDoc);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeMongoDoc(item)]));
  }
  return value;
}

function prepareForFirestore(collectionName, doc) {
  if (collectionName !== "items" || !doc.photo) return doc;
  if (Buffer.byteLength(String(doc.photo), "utf8") <= MAX_FIRESTORE_STRING_BYTES) return doc;
  return {
    ...doc,
    photo: DEFAULT_PHOTO,
    photoMigrationNote: "Original MongoDB photo exceeded Firestore document size limits.",
  };
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefined(item)])
    );
  }
  return value;
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}

module.exports = { migrate };
