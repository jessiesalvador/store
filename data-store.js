const imageBase = "https://images.unsplash.com/";
const freshCartOwnerEmail = "eisse_jay@yahoo.com";
const superAdminEmail = "ai.jessie@outlook.com";
const storeAdminPassword = "FreshCartOwner#2026";
const superAdminPassword = "SuperAdmin#2026";

const initialFreshCartState = {
  selectedStore: "all",
  selectedCategory: "all",
  selectedAdminStore: "green-valley",
  selectedAdminAssignment: "green-valley",
  selectedInventoryCategory: "all",
  cart: {},
  orders: [],
  stores: [
    {
      id: "green-valley",
      name: "FreshCart",
      location: "Brisbane CBD",
      ownerEmail: freshCartOwnerEmail,
      categories: ["Produce", "Dairy", "Bakery", "Pantry"],
    },
    {
      id: "harbor-fresh",
      name: "Harbor Fresh Market",
      location: "South Bank",
      ownerEmail: "owner@harborfresh.example",
      categories: ["Produce", "Seafood", "Deli", "Frozen"],
    },
  ],
  items: [
    {
      id: "apples",
      storeId: "green-valley",
      name: "Royal gala apples",
      category: "Produce",
      price: 4.25,
      soldOut: false,
      photo: `${imageBase}photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=700&q=80`,
    },
    {
      id: "milk",
      storeId: "green-valley",
      name: "Organic whole milk",
      category: "Dairy",
      price: 3.8,
      soldOut: false,
      photo: `${imageBase}photo-1563636619-e9143da7973b?auto=format&fit=crop&w=700&q=80`,
    },
    {
      id: "sourdough",
      storeId: "green-valley",
      name: "Crusty sourdough loaf",
      category: "Bakery",
      price: 6.5,
      soldOut: false,
      photo: `${imageBase}photo-1509440159596-0249088772ff?auto=format&fit=crop&w=700&q=80`,
    },
    {
      id: "rice",
      storeId: "green-valley",
      name: "Jasmine rice 2 kg",
      category: "Pantry",
      price: 7.2,
      soldOut: false,
      photo: `${imageBase}photo-1586201375761-83865001e31c?auto=format&fit=crop&w=700&q=80`,
    },
    {
      id: "berries",
      storeId: "harbor-fresh",
      name: "Mixed berries punnet",
      category: "Produce",
      price: 5.9,
      soldOut: false,
      photo: `${imageBase}photo-1498557850523-fd3d118b962e?auto=format&fit=crop&w=700&q=80`,
    },
    {
      id: "salmon",
      storeId: "harbor-fresh",
      name: "Fresh salmon fillet",
      category: "Seafood",
      price: 14.75,
      soldOut: false,
      photo: `${imageBase}photo-1599084993091-1cb5c0721cc6?auto=format&fit=crop&w=700&q=80`,
    },
    {
      id: "cheese",
      storeId: "harbor-fresh",
      name: "Aged cheddar wedge",
      category: "Deli",
      price: 8.4,
      soldOut: false,
      photo: `${imageBase}photo-1486297678162-eb2a19b0a32d?auto=format&fit=crop&w=700&q=80`,
    },
    {
      id: "peas",
      storeId: "harbor-fresh",
      name: "Frozen garden peas",
      category: "Frozen",
      price: 3.35,
      soldOut: false,
      photo: `${imageBase}photo-1566383444833-43afb88e5dc9?auto=format&fit=crop&w=700&q=80`,
    },
  ],
  admins: [
    {
      name: "FreshCart Owner",
      email: freshCartOwnerEmail,
      password: storeAdminPassword,
      storeId: "green-valley",
    },
  ],
  requests: [
    {
      id: "req-1",
      storeName: "Morning Basket Foods",
      ownerName: "Luis Ramos",
    },
  ],
};

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  const saved = localStorage.getItem("freshcart-state");
  const state = saved ? { ...cloneState(initialFreshCartState), ...JSON.parse(saved) } : cloneState(initialFreshCartState);
  return normalizeState(state);
}

function saveState(state) {
  localStorage.setItem("freshcart-state", JSON.stringify(state));
}

function normalizeState(state) {
  state.cart = state.cart || {};
  state.orders = state.orders || [];
  state.requests = state.requests || [];
  state.admins = state.admins || [];
  state.stores = state.stores || [];
  state.items = state.items || [];

  const freshCartStore = state.stores.find((store) => store.id === "green-valley");
  if (freshCartStore) {
    freshCartStore.name = "FreshCart";
    freshCartStore.ownerEmail = freshCartOwnerEmail;
  }

  state.stores.forEach((store) => {
    store.ownerEmail = store.ownerEmail || "";
    store.categories = store.categories || ["Produce"];
  });
  state.items.forEach((item) => {
    item.soldOut = Boolean(item.soldOut);
  });
  state.orders.forEach((order) => {
    order.archived = Boolean(order.archived);
    order.status = order.readAt ? "Read" : "Unread";
  });
  if (!state.admins.some((admin) => admin.email === freshCartOwnerEmail)) {
    state.admins.push({
      name: "FreshCart Owner",
      email: freshCartOwnerEmail,
      password: storeAdminPassword,
      storeId: "green-valley",
    });
  }
  state.admins.forEach((admin) => {
    if (admin.email === freshCartOwnerEmail) admin.password = storeAdminPassword;
    admin.password = admin.password || generateTemporaryPassword();
  });
  return state;
}

function getStore(state, id) {
  return state.stores.find((store) => store.id === id);
}

function storePageUrl(storeId) {
  return `store.html?store=${encodeURIComponent(storeId)}`;
}

function sampleItemForStore(storeId, storeName) {
  return {
    id: `${storeId}-sample-item-${Date.now()}`,
    storeId,
    name: `${storeName} sample grocery box`,
    category: "Sample category",
    price: 9.99,
    soldOut: false,
    photo: `${imageBase}photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80`,
  };
}

function generateTemporaryPassword() {
  return `Temp-${Math.random().toString(36).slice(2, 6)}-${Date.now().toString().slice(-4)}`;
}

function changeStoreId(state, oldId, nextId) {
  const store = getStore(state, oldId);
  if (!store || !nextId || getStore(state, nextId)) return false;
  store.id = nextId;
  state.items.forEach((item) => {
    if (item.storeId === oldId) item.storeId = nextId;
  });
  state.orders.forEach((order) => {
    if (order.storeId === oldId) order.storeId = nextId;
  });
  state.admins.forEach((admin) => {
    if (admin.storeId === oldId) admin.storeId = nextId;
  });
  if (state.selectedAdminStore === oldId) state.selectedAdminStore = nextId;
  if (state.selectedAdminAssignment === oldId) state.selectedAdminAssignment = nextId;
  if (state.selectedStore === oldId) state.selectedStore = nextId;
  return true;
}

function deleteStore(state, storeId) {
  state.stores = state.stores.filter((store) => store.id !== storeId);
  state.items = state.items.filter((item) => item.storeId !== storeId);
  state.orders = state.orders.filter((order) => order.storeId !== storeId);
  state.admins = state.admins.filter((admin) => admin.storeId !== storeId);
  if (state.selectedAdminStore === storeId) state.selectedAdminStore = state.stores[0]?.id || "";
  if (state.selectedAdminAssignment === storeId) state.selectedAdminAssignment = state.stores[0]?.id || "";
  if (state.selectedStore === storeId) state.selectedStore = "all";
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

function checkLogin(role, email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  if (role === "store") {
    const state = loadState();
    return state.admins.some((admin) => admin.email === normalizedEmail && admin.password === password);
  }
  return normalizedEmail === superAdminEmail && password === superAdminPassword;
}
