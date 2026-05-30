/**
 * Run once to seed the database:
 *   npm run seed
 *
 * Safe to re-run — skips documents that already exist.
 */

require("dotenv").config();
const mongoose = require("mongoose");

// Import models directly (no app middleware needed)
const User = require("../src/models/User");
const Store = require("../src/models/Store");
const Item = require("../src/models/Item");

const IMAGE_BASE = "https://images.unsplash.com/";

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  // ── Super admin ──────────────────────────────────────────────────────────────
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;

  let superAdmin = await User.findOne({ email: superEmail });
  if (!superAdmin) {
    superAdmin = await User.create({
      name: "Super Admin",
      email: superEmail,
      passwordHash: superPassword,  // pre-save hook hashes this
      role: "super-admin",
      mustChangePassword: false,
    });
    console.log("✅ Super admin created:", superEmail);
  } else {
    console.log("⏭  Super admin already exists — skipped.");
  }

  // ── Stores ───────────────────────────────────────────────────────────────────
  const storesData = [
    {
      name: "FreshCart",
      slug: "freshcart",
      location: "Brisbane CBD",
      ownerEmail: "eisse_jay@yahoo.com",
      categories: ["Produce", "Dairy", "Bakery", "Pantry"],
      approved: true,
    },
    {
      name: "Harbor Fresh Market",
      slug: "harbor-fresh-market",
      location: "South Bank",
      ownerEmail: "owner@harborfresh.example",
      categories: ["Produce", "Seafood", "Deli", "Frozen"],
      approved: true,
    },
  ];

  const storeMap = {}; // slug → ObjectId

  for (const data of storesData) {
    let store = await Store.findOne({ slug: data.slug });
    if (!store) {
      store = await Store.create(data);
      console.log(`✅ Store created: ${store.name}`);
    } else {
      console.log(`⏭  Store "${store.name}" already exists — skipped.`);
    }
    storeMap[data.slug] = store._id;
  }

  // ── Store admins ─────────────────────────────────────────────────────────────
  const adminsData = [
    {
      name: "FreshCart Owner",
      email: "eisse_jay@yahoo.com",
      password: "FreshCartOwner#2026",
      storeSlug: "freshcart",
    },
  ];

  for (const data of adminsData) {
    let admin = await User.findOne({ email: data.email });
    if (!admin) {
      admin = await User.create({
        name: data.name,
        email: data.email,
        // Pass plaintext — pre-save hook hashes it
        passwordHash: data.password,
        role: "store-admin",
        storeId: storeMap[data.storeSlug],
        mustChangePassword: false,
      });
      console.log(`✅ Store admin created: ${admin.email}`);
    } else {
      console.log(`⏭  Store admin "${admin.email}" already exists — skipped.`);
    }
  }

  // ── Items ────────────────────────────────────────────────────────────────────
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
    const storeId = storeMap[data.storeSlug];
    const exists = await Item.findOne({ storeId, name: data.name });
    if (!exists) {
      await Item.create({ storeId, name: data.name, category: data.category, price: data.price, photo: data.photo });
      console.log(`✅ Item added: ${data.name}`);
    } else {
      console.log(`⏭  Item "${data.name}" already exists — skipped.`);
    }
  }

  console.log("\n🌱 Seed complete.");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});