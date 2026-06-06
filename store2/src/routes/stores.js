const express = require("express");
const slugifyLib = require("slugify");
const { requireSuperAdmin, requireStoreAdmin, requireStoreOwnership } = require("../middleware/guards");
const { createRateLimiter } = require("../middleware/rateLimiters");
const { col, createDoc, deleteDoc, fromQuery, getById, updateDoc } = require("../utils/firestoreData");

const router = express.Router();
const MAX_CHAT_HISTORY = 8;
const MAX_CHAT_ITEMS = 120;
const MAX_ASSISTANT_NOTES = 12;
const MAX_ASSISTANT_SYNONYMS = 80;

const chatLimiter = createRateLimiter("stores-chat", {
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many chat messages. Please try again soon." },
});

const chatFeedbackLimiter = createRateLimiter("stores-chat-feedback", {
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many feedback submissions. Please try again soon." },
});

function makeSlug(name) {
  return slugifyLib(name, { lower: true, strict: true });
}

function cleanHero(input = {}) {
  const fields = ["eyebrow", "headline", "subheading", "detail"];
  const hero = {};
  fields.forEach((field) => {
    if (input[field] !== undefined) {
      hero[field] = String(input[field] || "").trim().slice(0, field === "headline" ? 90 : 180);
    }
  });
  return hero;
}

function cleanCategories(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const categories = [];

  input.forEach((category) => {
    const cleaned = String(category || "").trim().slice(0, 60);
    const key = cleaned.toLowerCase();
    if (cleaned && !seen.has(key)) {
      seen.add(key);
      categories.push(cleaned);
    }
  });

  return categories;
}

function publicStore(store) {
  if (!store) return null;
  const { assistantNotes, assistantSynonyms, ownerEmail, ...safe } = store;
  safe.orderEmailOtpRequired = Boolean(store.orderEmailOtpRequired);
  return safe;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanAssistantNotes(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input
    .map((note) => cleanText(note, 220))
    .filter((note) => {
      const key = note.toLowerCase();
      if (!note || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ASSISTANT_NOTES);
}

function cleanAssistantSynonyms(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input
    .map((entry) => ({
      term: cleanText(entry?.term, 80),
      mapsTo: cleanText(entry?.mapsTo, 120),
    }))
    .filter((entry) => {
      const key = `${entry.term.toLowerCase()}=${entry.mapsTo.toLowerCase()}`;
      if (!entry.term || !entry.mapsTo || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ASSISTANT_SYNONYMS);
}

function assistantLearning(store) {
  return {
    notes: cleanAssistantNotes(store?.assistantNotes),
    synonyms: cleanAssistantSynonyms(store?.assistantSynonyms),
  };
}

function cleanChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_CHAT_HISTORY)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: cleanText(message?.content, 500),
    }))
    .filter((message) => message.content);
}

function itemSummary(item) {
  return {
    id: item._id,
    name: item.name,
    category: item.category,
    price: Number(item.price),
    soldOut: Boolean(item.soldOut),
  };
}

function money(value) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(value || 0));
}

function expandedQuestionTerms(question, synonyms) {
  const synonymTerms = synonyms
    .filter((entry) => question.includes(entry.term.toLowerCase()))
    .flatMap((entry) => [entry.mapsTo, entry.term]);
  return `${question} ${synonymTerms.join(" ")}`;
}

function localInventoryAnswer(store, items, message, learning = assistantLearning(store)) {
  const question = message.toLowerCase();
  const searchableQuestion = expandedQuestionTerms(question, learning.synonyms).toLowerCase();
  const available = items.filter((item) => !item.soldOut);
  const soldOut = items.filter((item) => item.soldOut);
  const categories = [...new Set(items.map((item) => item.category))];
  const terms = searchableQuestion
    .replace(/[^a-z0-9\s.]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !["any", "are", "does", "find", "have", "item", "items", "show", "that", "there", "this", "what", "with", "you", "available"].includes(word)
    );

  const priceMatch = question.match(/(?:under|below|less than|up to)\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (priceMatch) {
    const maxPrice = Number(priceMatch[1]);
    const matches = available.filter((item) => Number(item.price) <= maxPrice).slice(0, 8);
    if (matches.length) {
      return `Here are available items at ${store.name} under ${money(maxPrice)}: ${matches
        .map((item) => `${item.name} (${money(item.price)})`)
        .join(", ")}.`;
    }
    return `I couldn't find available items under ${money(maxPrice)} in ${store.name}'s current inventory.`;
  }

  const category = categories.find((cat) => searchableQuestion.includes(String(cat).toLowerCase()));
  if (category) {
    const matches = available.filter((item) => item.category === category).slice(0, 8);
    if (matches.length) {
      return `${store.name} has these available ${category} items: ${matches
        .map((item) => `${item.name} (${money(item.price)})`)
        .join(", ")}.`;
    }
    const soldOutMatches = soldOut.filter((item) => item.category === category).slice(0, 5);
    if (soldOutMatches.length) {
      return `${category} items are listed, but they are currently sold out: ${soldOutMatches
        .map((item) => item.name)
        .join(", ")}.`;
    }
  }

  const matches = items
    .map((item) => ({
      item,
      score: terms.reduce((sum, term) => {
        const haystack = `${item.name} ${item.category}`.toLowerCase();
        return sum + (haystack.includes(term) ? 1 : 0);
      }, 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Number(a.item.price) - Number(b.item.price))
    .slice(0, 6)
    .map(({ item }) => item);

  if (matches.length) {
    return matches
      .map((item) =>
        item.soldOut
          ? `${item.name} is listed in ${item.category}, but it is currently sold out.`
          : `${item.name} is available in ${item.category} for ${money(item.price)}.`
      )
      .join(" ");
  }

  if (terms.length) {
    return `I couldn't find ${terms.join(" ")} in ${store.name}'s current inventory. Try a category or ask for items under a certain price.`;
  }

  if (question.includes("breakfast")) {
    const picks = available
      .filter((item) => /bakery|dairy|produce|pantry/i.test(item.category))
      .slice(0, 6);
    if (picks.length) {
      return `For breakfast, ${store.name} currently has ${picks.map((item) => `${item.name} (${money(item.price)})`).join(", ")}.`;
    }
  }

  const sample = available.slice(0, 8);
  if (sample.length) {
    return `I can help with ${store.name}'s current inventory. Try asking for an item, category, or budget. Available examples: ${sample
      .map((item) => `${item.name} (${money(item.price)})`)
      .join(", ")}.`;
  }
  return `${store.name} does not have available items listed right now.`;
}

function extractAnthropicText(data) {
  return (data?.content || [])
    .filter((part) => part?.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function anthropicInventoryAnswer(store, items, message, history) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const inventory = items.slice(0, MAX_CHAT_ITEMS).map(itemSummary);
  const learning = assistantLearning(store);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 260,
      system: [
        "You are FreshCart's shopping assistant.",
        "Answer only using the provided store inventory.",
        "If an item is not in inventory, say you could not find it.",
        "If an item is sold out, say it is listed but currently sold out.",
        "Do not claim an item is available unless soldOut is false.",
        "Keep answers concise and useful. Mention prices in AUD when recommending items.",
        "Use admin correction notes and synonyms when they are relevant.",
        "You cannot place orders or change carts yet.",
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            store: { id: store._id, name: store.name, location: store.location, categories: store.categories },
            inventory,
            assistantLearning: learning,
            history,
            customerQuestion: message,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("Anthropic inventory chat failed:", response.status, text.slice(0, 500));
    return null;
  }

  const data = await response.json();
  return extractAnthropicText(data) || null;
}

// ─── GET /api/stores — public list of all approved stores ────────────────────
router.get("/", async (req, res, next) => {
  try {
    const stores = fromQuery(await col("stores").where("approved", "==", true).get())
      .map(publicStore)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json({ stores });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/stores/:storeId — single store (public) ────────────────────────
router.get("/:storeId", async (req, res, next) => {
  try {
    const store = publicStore(await getById("stores", req.params.storeId));
    if (!store || !store.approved) {
      return res.status(404).json({ error: "Store not found." });
    }
    res.json({ store });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/stores/:storeId/chat — customer shopping assistant ────────────
router.post("/:storeId/chat", chatLimiter, async (req, res, next) => {
  try {
    const message = cleanText(req.body.message, 500);
    if (!message) return res.status(400).json({ error: "Message is required." });

    const store = await getById("stores", req.params.storeId);
    if (!store || !store.approved) {
      return res.status(404).json({ error: "Store not found." });
    }

    const items = fromQuery(await col("items").where("storeId", "==", req.params.storeId).get())
      .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
    const history = cleanChatHistory(req.body.history);
    const learning = assistantLearning(store);
    const aiAnswer = await anthropicInventoryAnswer(store, items, message, history);
    const answer = aiAnswer || localInventoryAnswer(store, items, message, learning);

    res.json({
      message: answer,
      source: aiAnswer ? "ai" : "inventory",
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/stores/:storeId/chat-feedback — customer feedback ─────────────
router.post("/:storeId/chat-feedback", chatFeedbackLimiter, async (req, res, next) => {
  try {
    const rating = req.body.rating === "up" ? "up" : req.body.rating === "down" ? "down" : null;
    if (!rating) return res.status(400).json({ error: "rating must be up or down." });

    const store = await getById("stores", req.params.storeId);
    if (!store || !store.approved) return res.status(404).json({ error: "Store not found." });

    const feedback = await createDoc("assistantFeedback", {
      storeId: req.params.storeId,
      rating,
      question: cleanText(req.body.question, 500),
      answer: cleanText(req.body.answer, 1000),
      note: cleanText(req.body.note, 300),
      reviewed: false,
    });

    res.status(201).json({ feedback });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/stores/:storeId/assistant-settings — admin learning settings ───
router.get("/:storeId/assistant-settings", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const store = await getById("stores", req.params.storeId);
    if (!store) return res.status(404).json({ error: "Store not found." });

    const feedback = fromQuery(await col("assistantFeedback").where("storeId", "==", req.params.storeId).get())
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 30);

    res.json({
      settings: assistantLearning(store),
      feedback,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/stores/:storeId/assistant-settings — admin learning settings ─
router.patch("/:storeId/assistant-settings", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const store = await updateDoc("stores", req.params.storeId, {
      assistantNotes: cleanAssistantNotes(req.body.notes),
      assistantSynonyms: cleanAssistantSynonyms(req.body.synonyms),
    });
    if (!store) return res.status(404).json({ error: "Store not found." });
    res.json({ settings: assistantLearning(store) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/stores — super admin creates a store ──────────────────────────
router.post("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, location, ownerEmail, categories } = req.body;
    if (!name || !location || !ownerEmail) {
      return res.status(400).json({ error: "name, location and ownerEmail are required." });
    }

    const slug = makeSlug(name);
    const exists = fromQuery(await col("stores").where("slug", "==", slug).limit(1).get())[0];
    if (exists) {
      return res.status(409).json({ error: `A store with the slug "${slug}" already exists.` });
    }

    const storeCategories = cleanCategories(categories) || ["Produce"];

    const store = await createDoc("stores", {
      name,
      slug,
      location,
      ownerEmail: ownerEmail.toLowerCase(),
      categories: storeCategories.length ? storeCategories : ["Produce"],
      orderEmailOtpRequired: false,
      approved: true,
    });

    res.status(201).json({ store });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/stores/:storeId — update store details ───────────────────────
router.patch("/:storeId", requireStoreAdmin, requireStoreOwnership, async (req, res, next) => {
  try {
    const existingStore = await getById("stores", req.params.storeId);
    if (!existingStore) return res.status(404).json({ error: "Store not found." });

    const allowed = ["name", "location"];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (req.body.categories !== undefined) {
      const categories = cleanCategories(req.body.categories);
      if (!categories) return res.status(400).json({ error: "categories must be a list." });
      if (!categories.length) return res.status(400).json({ error: "Keep at least one category in the store." });

      const removedCategories = existingStore.categories.filter((category) => !categories.includes(category));
      if (removedCategories.length) {
        const itemInRemovedCategory = fromQuery(await col("items").where("storeId", "==", req.params.storeId).get()).find(
          (item) => removedCategories.includes(item.category)
        );

        if (itemInRemovedCategory) {
          return res.status(409).json({
            error: `Move or delete items in "${itemInRemovedCategory.category}" before removing it.`,
          });
        }
      }

      updates.categories = categories;
    }

    if (req.body.hero && typeof req.body.hero === "object") {
      updates.hero = cleanHero(req.body.hero);
    }

    if (req.body.orderEmailOtpRequired !== undefined) {
      updates.orderEmailOtpRequired = Boolean(req.body.orderEmailOtpRequired);
    }

    // Super admin can also update ownerEmail and public URL slug.
    if (req.session.role === "super-admin" && req.body.ownerEmail) {
      updates.ownerEmail = req.body.ownerEmail.toLowerCase();
    }
    if (req.session.role === "super-admin" && req.body.slug) {
      updates.slug = makeSlug(req.body.slug);
      if (!updates.slug) return res.status(400).json({ error: "slug must contain letters or numbers." });

      const existingSlug = fromQuery(await col("stores").where("slug", "==", updates.slug).limit(2).get()).find(
        (store) => store._id !== req.params.storeId
      );
      if (existingSlug) {
        return res.status(409).json({ error: `A store with the slug "${updates.slug}" already exists.` });
      }
    }

    if (updates.name && !updates.slug) updates.slug = makeSlug(updates.name);

    const store = await updateDoc("stores", req.params.storeId, updates, { base: existingStore });
    if (!store) return res.status(404).json({ error: "Store not found." });
    res.json({ store });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/stores/:storeId — super admin only ──────────────────────────
router.delete("/:storeId", requireSuperAdmin, async (req, res, next) => {
  try {
    const store = await deleteDoc("stores", req.params.storeId);
    if (!store) return res.status(404).json({ error: "Store not found." });

    // Cascade delete items, orders, and unlink admins
    const [itemsSnap, ordersSnap, usersSnap] = await Promise.all([
      col("items").where("storeId", "==", req.params.storeId).get(),
      col("orders").where("storeId", "==", req.params.storeId).get(),
      col("users").where("storeId", "==", req.params.storeId).get(),
    ]);
    const batch = col("stores").firestore.batch();
    itemsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    ordersSnap.docs.forEach((doc) => batch.delete(doc.ref));
    usersSnap.docs.forEach((doc) => batch.update(doc.ref, { storeId: null }));
    await batch.commit();

    res.json({ message: "Store and all related data deleted." });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/stores/:storeId/items — public item listing ────────────────────
router.get("/:storeId/items", async (req, res, next) => {
  try {
    const { category, sort } = req.query;
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 0, 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const search = String(req.query.search || "").trim().toLowerCase();
    const filter = { storeId: req.params.storeId };
    if (category && category !== "all") filter.category = category;

    const sortMap = {
      "price-asc": { price: 1 },
      "price-desc": { price: -1 },
      "name-asc": { name: 1 },
      "name-desc": { name: -1 },
    };

    let items = fromQuery(await col("items").where("storeId", "==", req.params.storeId).get());
    if (filter.category) items = items.filter((item) => item.category === filter.category);
    if (search) {
      items = items.filter((item) =>
        String(item.name || "").toLowerCase().includes(search) ||
        String(item.category || "").toLowerCase().includes(search)
      );
    }
    const sorter = sortMap[sort];
    if (sorter?.price) items.sort((a, b) => sorter.price * (Number(a.price) - Number(b.price)));
    else if (sorter?.name) items.sort((a, b) => sorter.name * String(a.name).localeCompare(String(b.name)));
    else items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const total = items.length;
    res.json({ items: limit ? items.slice(offset, offset + limit) : items, total, offset, limit: limit || total });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
