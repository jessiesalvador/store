/**
 * Run once to seed Firestore:
 *   SUPER_ADMIN_PASSWORD='...' npm run seed
 *
 * Safe to re-run. Existing stores, users, and items are skipped.
 */

require("dotenv").config();

const bcrypt = require("bcryptjs");
const { db } = require("../src/config/firebase");

const SALT_ROUNDS = 12;
const IMAGE_BASE = "https://images.unsplash.com/";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function now() {
  return new Date();
}

function publicLog(label, value) {
  console.log(`${label}: ${value}`);
}

async function firstBy(collectionName, field, value) {
  const snap = await db.collection(collectionName).where(field, "==", value).limit(1).get();
  return snap.empty ? null : { _id: snap.docs[0].id, id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function firstByFields(collectionName, filters) {
  let query = db.collection(collectionName);
  filters.forEach(([field, value]) => {
    query = query.where(field, "==", value);
  });
  const snap = await query.limit(1).get();
  return snap.empty ? null : { _id: snap.docs[0].id, id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function createDoc(collectionName, data) {
  const ref = db.collection(collectionName).doc();
  const timestamp = now();
  const payload = { ...data, createdAt: timestamp, updatedAt: timestamp };
  await ref.set(payload);
  return { _id: ref.id, id: ref.id, ...payload };
}

async function createUserIfMissing({ name, email, password, role, storeId = null, mustChangePassword = false }) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await firstBy("users", "email", normalizedEmail);
  if (existing) {
    publicLog("Skipped existing user", normalizedEmail);
    return existing;
  }

  const user = await createDoc("users", {
    name,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
    role,
    storeId,
    mustChangePassword,
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null,
  });
  publicLog("Created user", normalizedEmail);
  return user;
}

async function seedStores() {
  const storesData = [
    {
      name: "FreshCart",
      slug: "freshcart",
      location: "Brisbane CBD",
      ownerEmail: process.env.STORE_ADMIN_EMAIL || "eisse_jay@yahoo.com",
      categories: ["Produce", "Dairy", "Bakery", "Pantry"],
      approved: true,
      orderEmailOtpRequired: false,
    },
    {
      name: "Harbor Fresh Market",
      slug: "harbor-fresh-market",
      location: "South Bank",
      ownerEmail: "owner@harborfresh.example",
      categories: ["Produce", "Seafood", "Deli", "Frozen"],
      approved: true,
      orderEmailOtpRequired: false,
    },
  ];

  const storeMap = {};
  for (const data of storesData) {
    const existing = await firstBy("stores", "slug", data.slug);
    if (existing) {
      publicLog("Skipped existing store", existing.name);
      storeMap[data.slug] = existing;
      continue;
    }

    const store = await createDoc("stores", data);
    publicLog("Created store", store.name);
    storeMap[data.slug] = store;
  }
  return storeMap;
}

async function seedItems(storeMap) {
  const itemsData = [
    {
      storeSlug: "freshcart",
      name: "Royal gala apples",
      category: "Produce",
      price: 4.25,
      photo: `${IMAGE_BASE}photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=700&q=80`,
    },
    {
      storeSlug: "freshcart",
      name: "Organic whole milk",
      category: "Dairy",
      price: 3.8,
      photo: `${IMAGE_BASE}photo-1563636619-e9143da7973b?auto=format&fit=crop&w=700&q=80`,
    },
    {
      storeSlug: "freshcart",
      name: "Crusty sourdough loaf",
      category: "Bakery",
      price: 6.5,
      photo: `${IMAGE_BASE}photo-1509440159596-0249088772ff?auto=format&fit=crop&w=700&q=80`,
    },
    {
      storeSlug: "freshcart",
      name: "Jasmine rice 2 kg",
      category: "Pantry",
      price: 7.2,
      photo: `${IMAGE_BASE}photo-1586201375761-83865001e31c?auto=format&fit=crop&w=700&q=80`,
    },
    {
      storeSlug: "harbor-fresh-market",
      name: "Mixed berries punnet",
      category: "Produce",
      price: 5.9,
      photo: `${IMAGE_BASE}photo-1498557850523-fd3d118b962e?auto=format&fit=crop&w=700&q=80`,
    },
    {
      storeSlug: "harbor-fresh-market",
      name: "Fresh salmon fillet",
      category: "Seafood",
      price: 14.75,
      photo: `${IMAGE_BASE}photo-1599084993091-1cb5c0721cc6?auto=format&fit=crop&w=700&q=80`,
    },
    {
      storeSlug: "harbor-fresh-market",
      name: "Aged cheddar wedge",
      category: "Deli",
      price: 8.4,
      photo: `${IMAGE_BASE}photo-1486297678162-eb2a19b0a32d?auto=format&fit=crop&w=700&q=80`,
    },
    {
      storeSlug: "harbor-fresh-market",
      name: "Frozen garden peas",
      category: "Frozen",
      price: 3.35,
      photo: `${IMAGE_BASE}photo-1566383444833-43afb88e5dc9?auto=format&fit=crop&w=700&q=80`,
    },
  ];

  for (const data of itemsData) {
    const store = storeMap[data.storeSlug];
    if (!store) throw new Error(`Missing store for slug ${data.storeSlug}`);
    const existing = await firstByFields("items", [
      ["storeId", store._id],
      ["name", data.name],
    ]);
    if (existing) {
      publicLog("Skipped existing item", data.name);
      continue;
    }

    await createDoc("items", {
      storeId: store._id,
      name: data.name,
      category: data.category,
      price: data.price,
      photo: data.photo,
      photoStoragePath: null,
      soldOut: false,
    });
    publicLog("Created item", data.name);
  }
}

async function seed() {
  const superEmail = process.env.SUPER_ADMIN_EMAIL || "ai.jessie@outlook.com";
  const superPassword = requiredEnv("SUPER_ADMIN_PASSWORD");
  const storeAdminEmail = process.env.STORE_ADMIN_EMAIL || "eisse_jay@yahoo.com";
  const storeAdminPassword = process.env.STORE_ADMIN_PASSWORD || superPassword;

  const storeMap = await seedStores();

  await createUserIfMissing({
    name: "Super Admin",
    email: superEmail,
    password: superPassword,
    role: "super-admin",
  });

  await createUserIfMissing({
    name: "FreshCart Owner",
    email: storeAdminEmail,
    password: storeAdminPassword,
    role: "store-admin",
    storeId: storeMap.freshcart._id,
  });

  await seedItems(storeMap);
  console.log("Seed complete.");
}

if (require.main === module) {
  seed().catch((err) => {
    console.error("Seed failed:", err.message);
    process.exit(1);
  });
}

module.exports = { seed };
