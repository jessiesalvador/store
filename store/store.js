/**
 * store.js — customer-facing shop page, wired to the FreshCart API.
 * Depends on: api.js (loaded before this script in store.html)
 */

// ── State ─────────────────────────────────────────────────────────────────────
const params       = new URLSearchParams(window.location.search);
const storeLookup  = params.get("id") || params.get("store") || "freshcart";
let   store        = null;   // populated from API
let   allItems     = [];     // all items for this store from API
let   cart         = {};     // { itemId: quantity } — kept in localStorage for UX
let   selectedCategory = "all";
let   selectedSort     = "default";

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

function h(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Persist cart locally, scoped per store slug so stores don't share carts
function cartKey()       { return `fc-cart:${store?.slug || storeLookup}`; }
function loadCart()      { try { return JSON.parse(localStorage.getItem(cartKey()) || "{}"); } catch { return {}; } }
function saveCart(c)     { localStorage.setItem(cartKey(), JSON.stringify(c)); }
cart = loadCart();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const els = {
  pageName:             document.querySelector("#store-page-name"),
  location:             document.querySelector("#store-location"),
  search:               document.querySelector("#store-search-input"),
  sortSelect:           document.querySelector("#store-sort"),
  categoryFilters:      document.querySelector("#store-category-filters"),
  productGrid:          document.querySelector("#store-product-grid"),
  resultCount:          document.querySelector("#store-result-count"),
  cartItems:            document.querySelector("#store-cart-items"),
  cartCount:            document.querySelector("#store-cart-count"),
  subtotal:             document.querySelector("#store-subtotal"),
  grandTotal:           document.querySelector("#store-grand-total"),
  sendOrderButton:      document.querySelector("#store-send-order-button"),
  toast:                document.querySelector("#toast"),
  heroStoreEyebrow:     document.querySelector("#hero-store-eyebrow"),
  heroStoreName:        document.querySelector("#hero-store-name"),
  heroStoreLocation:    document.querySelector("#hero-store-location"),
  heroStoreDetail:      document.querySelector("#hero-store-detail"),
  mobileFab:            document.querySelector("#mobile-cart-fab"),
  fabBadge:             document.querySelector("#fab-badge"),
  cartDrawer:           document.querySelector("#cart-drawer"),
  cartDrawerBackdrop:   document.querySelector("#cart-drawer-backdrop"),
  drawerClose:          document.querySelector("#drawer-close"),
  drawerCartItems:      document.querySelector("#drawer-cart-items"),
  drawerGrandTotal:     document.querySelector("#drawer-grand-total"),
  drawerSendOrderButton:document.querySelector("#drawer-send-order-button"),
  customerForms:        document.querySelectorAll("[data-customer-form]"),
  emailErrors:          document.querySelectorAll("[data-email-error]"),
};

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

// ── Mobile cart drawer ────────────────────────────────────────────────────────
function openCartDrawer() {
  els.cartDrawer.classList.add("open");
  els.cartDrawerBackdrop.classList.add("open");
  els.cartDrawer.setAttribute("aria-hidden", "false");
  els.mobileFab.setAttribute("aria-expanded", "true");
  renderDrawerCart();
}
function closeCartDrawer() {
  els.cartDrawer.classList.remove("open");
  els.cartDrawerBackdrop.classList.remove("open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
  els.mobileFab.setAttribute("aria-expanded", "false");
}
els.mobileFab.addEventListener("click", openCartDrawer);
els.drawerClose.addEventListener("click", closeCartDrawer);
els.cartDrawerBackdrop.addEventListener("click", closeCartDrawer);

// ── Filtering helpers ─────────────────────────────────────────────────────────
function visibleItems() {
  const term = els.search.value.trim().toLowerCase();
  let items = allItems.filter((item) => {
    const catOk  = selectedCategory === "all" || item.category === selectedCategory;
    const termOk = !term || item.name.toLowerCase().includes(term) || item.category.toLowerCase().includes(term);
    return catOk && termOk;
  });
  if (selectedSort === "price-asc")  items.sort((a, b) => a.price - b.price);
  if (selectedSort === "price-desc") items.sort((a, b) => b.price - a.price);
  if (selectedSort === "name-asc")   items.sort((a, b) => a.name.localeCompare(b.name));
  if (selectedSort === "name-desc")  items.sort((a, b) => b.name.localeCompare(a.name));
  return items;
}

// ── Category chips ────────────────────────────────────────────────────────────
function renderCategories() {
  if (!store) return;
  if (!store.categories.includes(selectedCategory)) selectedCategory = "all";

  function chip(value, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `category-chip${selectedCategory === value ? " active" : ""}`;
    btn.dataset.category = value;
    btn.setAttribute("aria-pressed", String(selectedCategory === value));
    const count = value === "all"
      ? allItems.length
      : allItems.filter((i) => i.category === value).length;
    btn.innerHTML = `<span>${h(label)}</span><strong>${count}</strong>`;
    return btn;
  }

  els.categoryFilters.replaceChildren(
    chip("all", "All categories"),
    ...store.categories.map((c) => chip(c, c))
  );
}

// ── Product grid ──────────────────────────────────────────────────────────────
function renderProducts() {
  const products = visibleItems();
  els.resultCount.textContent = `${products.length} ${products.length === 1 ? "item" : "items"}`;

  if (!products.length) {
    els.productGrid.innerHTML = `
      <div class="empty-state-fancy">
        <div class="empty-icon">🥦</div>
        <strong>Nothing matches those filters</strong>
        <p>Try a different category or search term.</p>
      </div>`;
    return;
  }

  els.productGrid.replaceChildren(...products.map((item) => {
    const qty  = cart[item._id] || 0;
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-img-wrap">
        <img src="${h(item.photo)}" alt="${h(item.name)}" loading="lazy">
        ${qty > 0 ? `<span class="card-qty-badge" aria-label="${qty} in cart">${qty}</span>` : ""}
      </div>
      <div class="product-body">
        <div class="meta-row">
          <span class="tag">${h(item.category)}</span>
          ${item.soldOut ? `<span class="sold-out-tag">Sold out</span>` : ""}
        </div>
        <h3>${h(item.name)}</h3>
        <div class="meta-row product-actions">
          <span class="price">${money.format(item.price)}</span>
          ${item.soldOut
            ? `<button type="button" disabled class="sold-out-btn">Sold out</button>`
            : qty > 0
              ? `<div class="card-qty-controls" aria-label="Quantity for ${h(item.name)}">
                  <button type="button" class="qty-btn" data-decrease="${item._id}" aria-label="Remove one ${h(item.name)}">−</button>
                  <span class="qty-display">${qty}</span>
                  <button type="button" class="qty-btn" data-add="${item._id}" aria-label="Add one ${h(item.name)}">+</button>
                 </div>`
              : `<button type="button" class="add-btn" data-add="${item._id}">Add</button>`
          }
        </div>
      </div>`;
    return card;
  }));
}

// ── Cart ──────────────────────────────────────────────────────────────────────
function cartEntries() {
  return Object.entries(cart)
    .map(([id, qty]) => ({ item: allItems.find((i) => i._id === id), qty }))
    .filter(({ item, qty }) => item && !item.soldOut && qty > 0);
}

function cartTotal() {
  return cartEntries().reduce((sum, { item, qty }) => sum + item.price * qty, 0);
}

function buildCartRows(entries) {
  return entries.map(({ item, qty }) => {
    const row = document.createElement("div");
    row.className = "cart-line";
    row.innerHTML = `
      <div class="cart-row">
        <strong>${h(item.name)}</strong>
        <span>${money.format(item.price * qty)}</span>
      </div>
      <div class="cart-row">
        <small>${h(store.name)}</small>
        <div class="quantity-actions" aria-label="Quantity controls for ${h(item.name)}">
          <button type="button" data-decrease="${item._id}" aria-label="Remove one ${h(item.name)}">−</button>
          <strong>${qty}</strong>
          <button type="button" data-increase="${item._id}" aria-label="Add one ${h(item.name)}">+</button>
        </div>
      </div>`;
    return row;
  });
}

function renderCart() {
  const entries  = cartEntries();
  const totalQty = entries.reduce((s, { qty }) => s + qty, 0);
  els.cartCount.textContent = String(totalQty);
  els.fabBadge.textContent  = String(totalQty);
  els.mobileFab.classList.toggle("has-items", totalQty > 0);

  const empty = `<div class="empty-state-fancy small"><div class="empty-icon">🛒</div><p>Your cart is empty.</p></div>`;
  els.cartItems.innerHTML = "";
  if (entries.length) els.cartItems.replaceChildren(...buildCartRows(entries));
  else els.cartItems.innerHTML = empty;

  const total = cartTotal();
  els.subtotal.textContent   = money.format(total);
  els.grandTotal.textContent = money.format(total);
}

function renderDrawerCart() {
  const entries = cartEntries();
  const empty   = `<div class="empty-state-fancy small"><div class="empty-icon">🛒</div><p>Your cart is empty.</p></div>`;
  if (entries.length) els.drawerCartItems.replaceChildren(...buildCartRows(entries));
  else els.drawerCartItems.innerHTML = empty;
  els.drawerGrandTotal.textContent      = money.format(cartTotal());
}

function adjustCart(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  saveCart(cart);
  renderCart();
  renderProducts();
}

function activeCustomerForm() {
  return els.cartDrawer.classList.contains("open") ? els.customerForms[1] : els.customerForms[0];
}

function clearEmailErrors() {
  els.emailErrors.forEach((el) => {
    el.textContent = "";
  });
}

function showEmailError(form, message) {
  const error = form.querySelector("[data-email-error]");
  if (error) error.textContent = message;
}

function customerDetails() {
  const form = activeCustomerForm();
  clearEmailErrors();
  const data = new FormData(form);
  const email = data.get("customerEmail").trim().toLowerCase();
  const emailInput = form.querySelector('[name="customerEmail"]');

  if (!email) {
    showEmailError(form, "Email is required.");
    emailInput.focus();
    return null;
  }
  if (!emailInput.checkValidity()) {
    showEmailError(form, "Enter a valid email address.");
    emailInput.focus();
    return null;
  }

  return {
    name: data.get("customerName").trim(),
    email,
    phone: data.get("customerPhone").trim(),
    note: data.get("customerNote").trim(),
  };
}

// ── Send order (POST to API) ──────────────────────────────────────────────────
async function sendOrder() {
  const entries = cartEntries();
  if (!entries.length) {
    showToast("Add at least one item before sending an order.");
    return;
  }
  const customer = customerDetails();
  if (!customer) return;

  try {
    await api.post(`/stores/${store._id}/orders`, { cart, customer });
    cart = {};
    saveCart(cart);
    els.customerForms.forEach((form) => form.reset());
    clearEmailErrors();
    renderCart();
    renderProducts();
    closeCartDrawer();
    showToast(`Order sent to ${store.name}!`);
  } catch (err) {
    showToast(err.message || "Failed to send order. Please try again.");
  }
}

// ── Cart click handlers ───────────────────────────────────────────────────────
function cartClickHandler(event) {
  const inc = event.target.closest("[data-increase]");
  const dec = event.target.closest("[data-decrease]");
  if (inc) adjustCart(inc.dataset.increase,  1);
  if (dec) adjustCart(dec.dataset.decrease, -1);
  renderDrawerCart();
}
els.cartItems.addEventListener("click", cartClickHandler);
els.drawerCartItems.addEventListener("click", cartClickHandler);

els.productGrid.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  const dec = event.target.closest("[data-decrease]");
  if (add) { adjustCart(add.dataset.add,  1); showToast("Added to cart."); }
  if (dec) { adjustCart(dec.dataset.decrease, -1); }
});

els.sendOrderButton.addEventListener("click", sendOrder);
els.drawerSendOrderButton.addEventListener("click", sendOrder);

els.search.addEventListener("input", () => { renderCategories(); renderProducts(); });
els.sortSelect.addEventListener("change", () => { selectedSort = els.sortSelect.value; renderProducts(); });
els.categoryFilters.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-category]");
  if (!btn) return;
  selectedCategory = btn.dataset.category;
  renderCategories();
  renderProducts();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    // Load store by friendly slug from ?id= / ?store=, with ObjectId fallback for old links.
    const storesData = await api.get("/stores");
    store = storesData.stores.find((s) => s.slug === storeLookup || s._id === storeLookup);

    if (!store) {
      document.querySelector("main").innerHTML = `
        <section class="panel auth-panel">
          <h2>Store not found</h2>
          <p class="helper-text">This shop page does not exist yet.</p>
          <a class="ghost-link" href="super-admin.html">Go to super admin</a>
        </section>`;
      return;
    }

    // Load items
    const itemsData = await api.get(`/stores/${store._id}/items`);
    allItems = itemsData.items;

    // Render page
    const hero = store.hero || {};
    const defaultDetail = `${store.name} - ${store.location}`;
    document.title             = `${store.name} | FreshCart`;
    els.pageName.textContent   = store.name;
    els.location.textContent   = store.location;
    els.heroStoreEyebrow.textContent  = hero.eyebrow || "Fresh & local";
    els.heroStoreName.textContent     = hero.headline || `${store.name} - fresh picks`;
    els.heroStoreLocation.textContent = hero.subheading || "Browse seasonal produce, pantry staples, and more.";
    els.heroStoreDetail.textContent   = hero.detail || defaultDetail;

    renderCategories();
    renderProducts();
    renderCart();
  } catch (err) {
    document.querySelector("main").innerHTML = `
      <section class="panel auth-panel">
        <h2>Could not load store</h2>
        <p class="helper-text">${err.message}</p>
      </section>`;
  }
}

boot();
