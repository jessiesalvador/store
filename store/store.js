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
let   itemOffset       = 0;
let   itemTotal        = 0;
let   isLoadingItems   = false;
let   emailOtpState = {
  email: null,
  otpId: null,
  verifiedToken: null,
};
let   chatMessages = [];

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const ITEM_PAGE_SIZE = 36;

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
  categorySelect:       document.querySelector("#store-category-select"),
  categoryFilters:      document.querySelector("#store-category-filters"),
  productGrid:          document.querySelector("#store-product-grid"),
  loadMore:             document.querySelector("#store-load-more"),
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
  drawerOrderError:     document.querySelector("#drawer-order-error"),
  drawerSendOrderButton:document.querySelector("#drawer-send-order-button"),
  customerForms:        document.querySelectorAll("[data-customer-form]"),
  emailErrors:          document.querySelectorAll("[data-email-error]"),
  otpPanels:            document.querySelectorAll("[data-otp-panel]"),
  chatFab:              document.querySelector("#chat-fab"),
  chatPanel:            document.querySelector("#chat-panel"),
  chatClose:            document.querySelector("#chat-close"),
  chatMessages:         document.querySelector("#chat-messages"),
  chatForm:             document.querySelector("#chat-form"),
  chatInput:            document.querySelector("#chat-input"),
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
  clearDrawerOrderError();
  els.cartDrawer.classList.add("open");
  els.cartDrawerBackdrop.classList.add("open");
  els.cartDrawer.setAttribute("aria-hidden", "false");
  els.mobileFab.setAttribute("aria-expanded", "true");
  renderDrawerCart();
}
function closeCartDrawer() {
  clearDrawerOrderError();
  els.cartDrawer.classList.remove("open");
  els.cartDrawerBackdrop.classList.remove("open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
  els.mobileFab.setAttribute("aria-expanded", "false");
}
els.mobileFab.addEventListener("click", openCartDrawer);
els.drawerClose.addEventListener("click", closeCartDrawer);
els.cartDrawerBackdrop.addEventListener("click", closeCartDrawer);

function showDrawerOrderError(message) {
  els.drawerOrderError.textContent = message;
  els.drawerOrderError.classList.remove("hidden");
}

function clearDrawerOrderError() {
  els.drawerOrderError.textContent = "";
  els.drawerOrderError.classList.add("hidden");
}

function activeOtpPanel() {
  return activeCustomerForm().querySelector("[data-otp-panel]");
}

function showOtpMessage(panel, message, isError = true) {
  const messageEl = panel?.querySelector("[data-otp-message]");
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.style.color = isError ? "" : "var(--brand)";
}

function resetEmailOtpState() {
  emailOtpState = { email: null, otpId: null, verifiedToken: null };
  els.otpPanels.forEach((panel) => {
    panel.querySelector('[name="emailOtp"]').value = "";
    showOtpMessage(panel, "");
  });
  updateSendOrderButtons();
}

function renderOtpPanels() {
  const required = Boolean(store?.orderEmailOtpRequired);
  els.otpPanels.forEach((panel) => {
    panel.classList.toggle("hidden", !required);
  });
  updateSendOrderButtons();
}

function updateSendOrderButtons() {
  const disabled = Boolean(store?.orderEmailOtpRequired && !emailOtpState.verifiedToken);
  els.sendOrderButton.disabled = disabled;
  els.drawerSendOrderButton.disabled = disabled;
}

// ── Shopping assistant ───────────────────────────────────────────────────────
function toggleChat(open = els.chatPanel.classList.contains("hidden")) {
  els.chatPanel.classList.toggle("hidden", !open);
  els.chatFab.setAttribute("aria-expanded", String(open));
  if (open) els.chatInput.focus();
}

function addChatMessage(role, content, feedback = null) {
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.textContent = content;
  els.chatMessages.append(message);
  if (feedback && role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "chat-feedback";
    actions.innerHTML = `
      <span>Was this helpful?</span>
      <button class="ghost-button" type="button" data-chat-rating="up">Good</button>
      <button class="ghost-button" type="button" data-chat-rating="down">Needs work</button>`;
    actions.dataset.question = feedback.question;
    actions.dataset.answer = content;
    els.chatMessages.append(actions);
  }
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function sendChatFeedback(button) {
  if (!store) return;
  const actions = button.closest(".chat-feedback");
  if (!actions || actions.dataset.sent === "true") return;

  actions.querySelectorAll("button").forEach((btn) => { btn.disabled = true; });
  try {
    await api.post(`/stores/${store._id}/chat-feedback`, {
      rating: button.dataset.chatRating,
      question: actions.dataset.question,
      answer: actions.dataset.answer,
    });
    actions.dataset.sent = "true";
    actions.innerHTML = `<span>Thanks for the feedback.</span>`;
  } catch (err) {
    actions.querySelectorAll("button").forEach((btn) => { btn.disabled = false; });
    showToast(err.message || "Failed to save feedback.");
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (!store) return;

  const message = els.chatInput.value.trim();
  if (!message) return;

  chatMessages.push({ role: "user", content: message });
  addChatMessage("user", message);
  els.chatInput.value = "";
  els.chatInput.disabled = true;
  const submitButton = els.chatForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Thinking...";

  try {
    const data = await api.post(`/stores/${store._id}/chat`, {
      message,
      history: chatMessages.slice(-8),
    });
    const reply = data.message || "I couldn't answer that right now.";
    chatMessages.push({ role: "assistant", content: reply });
    addChatMessage("assistant", reply, { question: message });
  } catch (err) {
    const reply = err.message || "The shopping assistant is unavailable right now.";
    chatMessages.push({ role: "assistant", content: reply });
    addChatMessage("assistant", reply);
  } finally {
    els.chatInput.disabled = false;
    submitButton.disabled = false;
    submitButton.textContent = "Send";
    els.chatInput.focus();
  }
}

// ── Filtering helpers ─────────────────────────────────────────────────────────
function visibleItems() {
  return allItems;
}

function itemQuery(offset = 0) {
  const query = new URLSearchParams({
    limit: String(ITEM_PAGE_SIZE),
    offset: String(offset),
  });
  if (selectedCategory !== "all") query.set("category", selectedCategory);
  if (selectedSort !== "default") query.set("sort", selectedSort);
  const term = els.search.value.trim();
  if (term) query.set("search", term);
  return query.toString();
}

async function loadItems({ reset = false } = {}) {
  if (!store || isLoadingItems) return;
  isLoadingItems = true;
  els.loadMore.disabled = true;
  els.loadMore.textContent = reset ? "Loading..." : "Loading more...";

  const nextOffset = reset ? 0 : itemOffset;
  try {
    const data = await api.get(`/stores/${store._id}/items?${itemQuery(nextOffset)}`);
    allItems = reset ? data.items : [...allItems, ...data.items];
    itemOffset = allItems.length;
    itemTotal = Number(data.total || allItems.length);
    renderCategories();
    renderProducts();
    renderCart();
  } catch (err) {
    showToast(err.message || "Failed to load items.");
  } finally {
    isLoadingItems = false;
    updateLoadMoreButton();
  }
}

function updateLoadMoreButton() {
  const hasMore = allItems.length < itemTotal;
  els.loadMore.classList.toggle("hidden", !hasMore);
  els.loadMore.disabled = isLoadingItems;
  els.loadMore.textContent = hasMore
    ? `Load more items (${allItems.length} of ${itemTotal})`
    : "Load more items";
}

// ── Category chips ────────────────────────────────────────────────────────────
function renderCategories() {
  if (!store) return;
  if (!store.categories.includes(selectedCategory)) selectedCategory = "all";

  function categoryCount(value) {
    return value === "all"
      ? itemTotal
      : value === selectedCategory
        ? itemTotal
        : allItems.filter((i) => i.category === value).length;
  }

  function chip(value, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `category-chip${selectedCategory === value ? " active" : ""}`;
    btn.dataset.category = value;
    btn.setAttribute("aria-pressed", String(selectedCategory === value));
    const count = categoryCount(value);
    btn.innerHTML = `<span>${h(label)}</span><strong>${count}</strong>`;
    return btn;
  }

  function categoryOption(value, label) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = `${label} (${categoryCount(value)})`;
    return opt;
  }

  els.categorySelect.replaceChildren(
    categoryOption("all", "All categories"),
    ...store.categories.map((c) => categoryOption(c, c))
  );
  els.categorySelect.value = selectedCategory;

  els.categoryFilters.replaceChildren(
    chip("all", "All categories"),
    ...store.categories.map((c) => chip(c, c))
  );
}

// ── Product grid ──────────────────────────────────────────────────────────────
function renderProducts() {
  const products = visibleItems();
  els.resultCount.textContent = itemTotal > products.length
    ? `Showing ${products.length} of ${itemTotal} items`
    : `${products.length} ${products.length === 1 ? "item" : "items"}`;

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
  updateLoadMoreButton();
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
  clearDrawerOrderError();
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

async function sendEmailOtp(form = activeCustomerForm()) {
  const customer = customerDetails();
  const panel = form.querySelector("[data-otp-panel]");
  if (!customer || !panel) return false;

  const sendButton = panel.querySelector("[data-send-otp]");
  sendButton.disabled = true;
  sendButton.textContent = "Sending...";
  showOtpMessage(panel, "");

  try {
    const data = await api.post(`/stores/${store._id}/orders/otp/start`, { email: customer.email });
    emailOtpState = { email: customer.email, otpId: data.otpId, verifiedToken: null };
    updateSendOrderButtons();
    showOtpMessage(panel, "Code sent. Check your email.", false);
    panel.querySelector('[name="emailOtp"]').focus();
    return true;
  } catch (err) {
    showOtpMessage(panel, err.message || "Failed to send verification code.");
    return false;
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "Send code";
  }
}

async function verifyEmailOtp(form = activeCustomerForm()) {
  const customer = customerDetails();
  const panel = form.querySelector("[data-otp-panel]");
  if (!customer || !panel) return false;

  const codeInput = panel.querySelector('[name="emailOtp"]');
  const code = codeInput.value.trim();
  if (!emailOtpState.otpId || emailOtpState.email !== customer.email) {
    showOtpMessage(panel, "Send a verification code first.");
    return false;
  }
  if (!/^\d{6}$/.test(code)) {
    showOtpMessage(panel, "Enter the 6-digit verification code.");
    codeInput.focus();
    return false;
  }

  const verifyButton = panel.querySelector("[data-verify-otp]");
  verifyButton.disabled = true;
  verifyButton.textContent = "Verifying...";
  showOtpMessage(panel, "");

  try {
    const data = await api.post(`/stores/${store._id}/orders/otp/verify`, {
      email: customer.email,
      otpId: emailOtpState.otpId,
      code,
    });
    emailOtpState = {
      email: customer.email,
      otpId: emailOtpState.otpId,
      verifiedToken: data.emailVerificationToken,
    };
    updateSendOrderButtons();
    showOtpMessage(panel, "Email verified. Send your order when ready.", false);
    return true;
  } catch (err) {
    showOtpMessage(panel, err.message || "Failed to verify code.");
    return false;
  } finally {
    verifyButton.disabled = false;
    verifyButton.textContent = "Verify code";
  }
}

async function ensureEmailVerified(customer, isDrawerOrder) {
  if (!store?.orderEmailOtpRequired) return true;
  const panel = activeOtpPanel();
  const notify = (message) => {
    showOtpMessage(panel, message);
    if (isDrawerOrder) showDrawerOrderError(message);
    else showToast(message);
  };

  if (emailOtpState.email === customer.email && emailOtpState.verifiedToken) {
    return true;
  }

  if (!emailOtpState.otpId || emailOtpState.email !== customer.email) {
    await sendEmailOtp();
    return false;
  }

  const code = panel.querySelector('[name="emailOtp"]').value.trim();
  if (/^\d{6}$/.test(code) && await verifyEmailOtp()) {
    return true;
  }

  notify("Enter and verify the code sent to your email.");
  panel.querySelector('[name="emailOtp"]').focus();
  return false;
}

// ── Send order (POST to API) ──────────────────────────────────────────────────
async function sendOrder(event) {
  const isDrawerOrder = event?.currentTarget === els.drawerSendOrderButton || els.cartDrawer.classList.contains("open");
  clearDrawerOrderError();
  const entries = cartEntries();
  if (!entries.length) {
    if (isDrawerOrder) {
      showDrawerOrderError("Add at least one item before sending an order.");
      return;
    }
    showToast("Add at least one item before sending an order.");
    return;
  }
  const customer = customerDetails();
  if (!customer) return;
  if (!(await ensureEmailVerified(customer, isDrawerOrder))) return;

  try {
    await api.post(`/stores/${store._id}/orders`, {
      cart,
      customer,
      emailVerificationToken: emailOtpState.verifiedToken,
    });
    cart = {};
    saveCart(cart);
    els.customerForms.forEach((form) => form.reset());
    resetEmailOtpState();
    clearEmailErrors();
    renderCart();
    renderProducts();
    closeCartDrawer();
    showToast(`Order sent to ${store.name}!`);
  } catch (err) {
    if (isDrawerOrder) {
      showDrawerOrderError(err.message || "Failed to send order. Please try again.");
      return;
    }
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
els.loadMore.addEventListener("click", () => loadItems());
els.chatFab.addEventListener("click", () => toggleChat());
els.chatClose.addEventListener("click", () => toggleChat(false));
els.chatForm.addEventListener("submit", sendChatMessage);
els.chatMessages.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("[data-chat-rating]");
  if (button) sendChatFeedback(button);
});

els.customerForms.forEach((form) => {
  form.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const sendOtpButton = event.target.closest("[data-send-otp]");
    const verifyOtpButton = event.target.closest("[data-verify-otp]");
    if (sendOtpButton) await sendEmailOtp(form);
    if (verifyOtpButton) await verifyEmailOtp(form);
  });

  form.querySelector('[name="customerEmail"]').addEventListener("input", resetEmailOtpState);
});

els.search.addEventListener("input", () => {
  clearTimeout(els.search._t);
  els.search._t = setTimeout(() => loadItems({ reset: true }), 220);
});
els.sortSelect.addEventListener("change", () => {
  selectedSort = els.sortSelect.value;
  loadItems({ reset: true });
});
els.categorySelect.addEventListener("change", () => {
  selectedCategory = els.categorySelect.value;
  loadItems({ reset: true });
});
els.categoryFilters.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-category]");
  if (!btn) return;
  selectedCategory = btn.dataset.category;
  loadItems({ reset: true });
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

    renderOtpPanels();
    await loadItems({ reset: true });
  } catch (err) {
    document.querySelector("main").innerHTML = `
      <section class="panel auth-panel">
        <h2>Could not load store</h2>
        <p class="helper-text">${err.message}</p>
      </section>`;
  }
}

boot();
