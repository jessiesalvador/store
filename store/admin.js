/**
 * admin.js — store admin dashboard, wired to the FreshCart API.
 * Depends on: api.js (loaded before this script in admin.html)
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser  = null;   // populated from GET /api/auth/me
let currentStore = null;   // the store this admin manages
let allItems     = [];     // items for current store
let allOrders    = [];     // orders for current store
let assistantSettings = { notes: [], synonyms: [] };
let assistantFeedback = [];
let selectedCategory        = "all";
let showArchived             = false;
let bulkInventoryEditMode    = false;
let itemOffset               = 0;
let itemTotal                = 0;
let isLoadingItems           = false;
const resetToken = new URLSearchParams(window.location.search).get("resetToken");

const ORDER_STATUSES = ["New", "Preparing", "Ready", "Fulfilled"];
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const MAX_PHOTO_BYTES = 650 * 1024;
const MAX_PHOTO_LABEL = "650 KB";
const ADMIN_ITEM_PAGE_SIZE = 80;

function h(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Failed to read image file.")));
    reader.readAsDataURL(file);
  });
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const els = {
  loadingPanel:           document.querySelector("#admin-loading-panel"),
  loginPanel:             document.querySelector("#admin-login-panel"),
  content:                document.querySelector("#admin-content"),
  loginForm:              document.querySelector("#admin-login-form"),
  logoutButton:           document.querySelector("#admin-logout-button"),
  forgotPasswordButton:   document.querySelector("#admin-forgot-password-button"),
  forgotPasswordModal:    document.querySelector("#forgot-password-modal"),
  forgotPasswordForm:     document.querySelector("#forgot-password-form"),
  forgotPasswordEmail:    document.querySelector("#forgot-password-email"),
  forgotPasswordMessage:  document.querySelector("#forgot-password-message"),
  forgotPasswordCancel:   document.querySelector("#forgot-password-cancel"),
  resetPasswordModal:     document.querySelector("#reset-password-modal"),
  resetPasswordForm:      document.querySelector("#reset-password-form"),
  resetNewPassword:       document.querySelector("#reset-new-password"),
  resetPasswordMessage:   document.querySelector("#reset-password-message"),
  shopLink:               document.querySelector("#admin-shop-link"),
  adminStore:             document.querySelector("#admin-store"),
  orderSettingsForm:      document.querySelector("#order-settings-form"),
  orderEmailOtpRequired:  document.querySelector("#order-email-otp-required"),
  heroForm:               document.querySelector("#hero-form"),
  heroResetButton:        document.querySelector("#hero-reset-button"),
  itemCategory:           document.querySelector("#item-category"),
  bulkItemForm:           document.querySelector("#bulk-item-form"),
  bulkItemFile:           document.querySelector("#bulk-item-file"),
  bulkItemMessage:        document.querySelector("#bulk-item-message"),
  assistantLearningForm:  document.querySelector("#assistant-learning-form"),
  assistantNotes:         document.querySelector("#assistant-notes"),
  assistantSynonyms:      document.querySelector("#assistant-synonyms"),
  assistantFeedbackList:  document.querySelector("#assistant-feedback-list"),
  inventoryCategoryFilter:document.querySelector("#inventory-category-filter"),
  adminCategoryList:      document.querySelector("#admin-category-list"),
  inventoryBody:          document.querySelector("#inventory-body"),
  inventoryCount:         document.querySelector("#inventory-count"),
  bulkInventoryEdit:      document.querySelector("#bulk-inventory-edit"),
  bulkInventorySave:      document.querySelector("#bulk-inventory-save"),
  loadMoreItems:          document.querySelector("#admin-load-more-items"),
  orderList:              document.querySelector("#order-list"),
  orderCount:             document.querySelector("#order-count"),
  showArchivedOrders:     document.querySelector("#show-archived-orders"),
  toast:                  document.querySelector("#toast"),
  changePasswordModal:    document.querySelector("#change-password-modal"),
  changePasswordForm:     document.querySelector("#change-password-form"),
  newPassword:            document.querySelector("#new-password"),
  confirmPassword:        document.querySelector("#confirm-password"),
  passwordError:          document.querySelector("#password-error"),
  itemSuccessBanner:      document.querySelector("#item-success-banner"),
  itemSuccessMessage:     document.querySelector("#item-success-message"),
  itemSuccessDismiss:     document.querySelector("#item-success-dismiss"),
};

// ── Toast / success banner ────────────────────────────────────────────────────
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function showFormMessage(el, message, isError = true) {
  el.textContent = message;
  el.classList.remove("hidden");
  el.style.color = isError ? "" : "var(--brand)";
}

function showItemSuccess(message) {
  els.itemSuccessMessage.textContent = message;
  els.itemSuccessBanner.classList.remove("hidden");
  els.itemSuccessBanner.classList.add("visible");
  clearTimeout(showItemSuccess._t);
  showItemSuccess._t = setTimeout(dismissItemSuccess, 5000);
}
function dismissItemSuccess() {
  els.itemSuccessBanner.classList.remove("visible");
  setTimeout(() => els.itemSuccessBanner.classList.add("hidden"), 300);
}
els.itemSuccessDismiss.addEventListener("click", dismissItemSuccess);

function option(value, label) {
  const el = document.createElement("option");
  el.value = value; el.textContent = label;
  return el;
}

function storeHref(store = currentStore) {
  return `store.html?id=${encodeURIComponent(store?.slug || store?._id || "freshcart")}`;
}

function updateShopLink() {
  els.shopLink.href = storeHref();
}

function currentUserStoreId() {
  const storeId = currentUser?.storeId;
  if (!storeId) return null;
  if (typeof storeId === "string") return storeId;
  return storeId._id || storeId.id || null;
}

function hasCurrentStore(message = "No store is assigned to this admin account.") {
  if (currentStore?._id) return true;
  showToast(message);
  return false;
}

function renderStoreUnavailable(message = "No store is assigned to this admin account.") {
  currentStore = null;
  allItems = [];
  allOrders = [];
  itemOffset = 0;
  itemTotal = 0;
  bulkInventoryEditMode = false;

  els.adminStore.replaceChildren(option("", "No assigned store"));
  els.itemCategory.replaceChildren(option("", "No assigned store"));
  els.inventoryCategoryFilter.replaceChildren(option("all", "All categories"));
  els.adminCategoryList.innerHTML = `<span class="empty-state">${h(message)}</span>`;
  els.inventoryCount.textContent = "0 items";
  els.bulkInventoryEdit.disabled = true;
  els.bulkInventoryEdit.textContent = "Bulk update";
  els.bulkInventorySave.disabled = true;
  els.inventoryBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">${h(message)}</div></td></tr>`;
  els.orderCount.textContent = "0 orders";
  els.orderList.innerHTML = `<div class="empty-state">${h(message)}</div>`;
  els.loadMoreItems.classList.add("hidden");
  updateShopLink();
}

function visibleInventoryItems() {
  return allItems;
}

function adminItemQuery(offset = 0) {
  const query = new URLSearchParams({
    limit: String(ADMIN_ITEM_PAGE_SIZE),
    offset: String(offset),
  });
  if (selectedCategory !== "all") query.set("category", selectedCategory);
  return query.toString();
}

function orderQuery() {
  return new URLSearchParams({ archived: String(showArchived) }).toString();
}

function updateAdminLoadMoreButton() {
  const hasMore = allItems.length < itemTotal;
  els.loadMoreItems.classList.toggle("hidden", !hasMore);
  els.loadMoreItems.disabled = isLoadingItems;
  els.loadMoreItems.textContent = hasMore
    ? `Load more items (${allItems.length} of ${itemTotal})`
    : "Load more items";
}

async function loadInventoryItems({ reset = false } = {}) {
  if (!currentStore || isLoadingItems) return;
  isLoadingItems = true;
  els.loadMoreItems.disabled = true;
  els.loadMoreItems.textContent = reset ? "Loading..." : "Loading more...";

  const nextOffset = reset ? 0 : itemOffset;
  try {
    const itemsData = await api.get(`/stores/${currentStore._id}/items?${adminItemQuery(nextOffset)}`);
    allItems = reset ? itemsData.items : [...allItems, ...itemsData.items];
    itemOffset = allItems.length;
    itemTotal = Number(itemsData.total || allItems.length);
    renderInventory();
  } catch (err) {
    showToast(err.message || "Failed to load inventory.");
  } finally {
    isLoadingItems = false;
    updateAdminLoadMoreButton();
  }
}

async function loadOrders() {
  if (!currentStore?._id) return;
  const ordersData = await api.get(`/stores/${currentStore._id}/orders?${orderQuery()}`);
  allOrders = ordersData.orders || [];
  renderOrders();
}

function categoryOptionsHtml(selected) {
  return currentStore.categories
    .map((category) => `<option value="${h(category)}"${category === selected ? " selected" : ""}>${h(category)}</option>`)
    .join("");
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseBulkItems(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error("The CSV file is empty.");

  const firstRow = rows[0].map((value) => value.toLowerCase().replace(/\s+/g, ""));
  const hasHeader =
    firstRow.includes("name") ||
    firstRow.includes("itemname") ||
    firstRow.includes("category") ||
    firstRow.includes("price");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const indexes = hasHeader
    ? {
        name: firstRow.findIndex((value) => value === "name" || value === "itemname"),
        category: firstRow.findIndex((value) => value === "category"),
        price: firstRow.findIndex((value) => value === "price"),
      }
    : { name: 0, category: 1, price: 2 };

  if (indexes.name < 0 || indexes.category < 0 || indexes.price < 0) {
    throw new Error("CSV must include item name, category, and price columns.");
  }

  const items = dataRows.map((row, index) => {
    const name = String(row[indexes.name] || "").trim();
    const category = String(row[indexes.category] || "").trim();
    const price = Number(String(row[indexes.price] || "").replace(/[$,]/g, ""));
    if (!name || !category || !Number.isFinite(price) || price <= 0) {
      throw new Error(`Row ${index + (hasHeader ? 2 : 1)} has an invalid item name, category, or price.`);
    }
    return { name, category, price };
  });

  if (!items.length) throw new Error("CSV must include at least one item row.");
  return items;
}

function parseAssistantNotes(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAssistantSynonyms(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const [term, ...rest] = line.split("=");
      return { term: String(term || "").trim(), mapsTo: rest.join("=").trim() };
    })
    .filter((entry) => entry.term && entry.mapsTo);
}

function formatAssistantSynonyms(synonyms = []) {
  return synonyms.map((entry) => `${entry.term} = ${entry.mapsTo}`).join("\n");
}

function heroDefaults(store = currentStore) {
  return {
    eyebrow: "Fresh & local",
    headline: `${store?.name || "Store"} - fresh picks`,
    subheading: "Browse seasonal produce, pantry staples, and more.",
    detail: `${store?.name || "Store"} - ${store?.location || ""}`.trim(),
  };
}

function fillHeroForm() {
  if (!currentStore) return;
  const defaults = heroDefaults();
  const hero = currentStore.hero || {};
  els.heroForm.elements.heroEyebrow.value = hero.eyebrow || defaults.eyebrow;
  els.heroForm.elements.heroHeadline.value = hero.headline || defaults.headline;
  els.heroForm.elements.heroSubheading.value = hero.subheading || defaults.subheading;
  els.heroForm.elements.heroDetail.value = hero.detail || defaults.detail;
}

function fillOrderSettings() {
  if (!currentStore) return;
  els.orderEmailOtpRequired.checked = Boolean(currentStore.orderEmailOtpRequired);
}

function fillAssistantLearningForm() {
  els.assistantNotes.value = (assistantSettings.notes || []).join("\n");
  els.assistantSynonyms.value = formatAssistantSynonyms(assistantSettings.synonyms || []);
}

function renderAssistantFeedback() {
  if (!assistantFeedback.length) {
    els.assistantFeedbackList.innerHTML = `<div class="empty-state">No assistant feedback yet.</div>`;
    return;
  }

  els.assistantFeedbackList.replaceChildren(...assistantFeedback.map((item) => {
    const card = document.createElement("article");
    card.className = "assistant-feedback-card";
    const sentAt = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
    card.innerHTML = `
      <div class="meta-row">
        <strong>${item.rating === "up" ? "Helpful" : "Needs work"}</strong>
        <small>${h(sentAt)}</small>
      </div>
      <p><strong>Asked:</strong> ${h(item.question || "")}</p>
      <p><strong>Answer:</strong> ${h(item.answer || "")}</p>
      ${item.note ? `<p><strong>Note:</strong> ${h(item.note)}</p>` : ""}`;
    return card;
  }));
}

// ── Render inventory ──────────────────────────────────────────────────────────
function renderInventory() {
  if (!currentStore) return;
  fillHeroForm();
  fillOrderSettings();

  // Category selects
  els.itemCategory.replaceChildren(...currentStore.categories.map((c) => option(c, c)));
  els.inventoryCategoryFilter.replaceChildren(
    option("all", "All categories"),
    ...currentStore.categories.map((c) => option(c, c))
  );
  if (!currentStore.categories.includes(selectedCategory)) selectedCategory = "all";
  els.inventoryCategoryFilter.value = selectedCategory;

  // Category chips display
  els.adminCategoryList.replaceChildren(
    ...currentStore.categories.map((c) => {
      const chip = document.createElement("span");
      chip.className = "tag removable-tag";

      const label = document.createElement("span");
      label.textContent = c;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-remove-button";
      button.dataset.removeCategory = c;
      button.setAttribute("aria-label", `Remove ${c} category`);
      button.title = `Remove ${c}`;
      button.textContent = "x";

      chip.append(label, button);
      return chip;
    })
  );

  const filtered = visibleInventoryItems();

  if (!filtered.length) {
    bulkInventoryEditMode = false;
    els.inventoryCount.textContent = itemTotal ? `Showing 0 of ${itemTotal} items` : "0 items";
    els.bulkInventoryEdit.disabled = true;
    els.bulkInventoryEdit.textContent = "Bulk update";
    els.bulkInventorySave.disabled = true;
    els.inventoryBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No items in this category yet.</div></td></tr>`;
    updateAdminLoadMoreButton();
    return;
  }

  els.inventoryCount.textContent = itemTotal > filtered.length
    ? `Showing ${filtered.length} of ${itemTotal} items`
    : `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;
  els.bulkInventoryEdit.disabled = false;
  els.bulkInventoryEdit.textContent = bulkInventoryEditMode ? "Cancel bulk update" : "Bulk update";
  els.bulkInventorySave.disabled = !bulkInventoryEditMode;

  els.inventoryBody.replaceChildren(...filtered.map((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img class="inventory-photo" src="${h(item.photo)}" alt="${h(item.name)}"></td>
      <td>${
        bulkInventoryEditMode
          ? `<label class="sr-only" for="name-${item._id}">Item name for ${h(item.name)}</label><input id="name-${item._id}" class="item-name-input" data-name="${item._id}" value="${h(item.name)}" maxlength="120">`
          : h(item.name)
      }</td>
      <td>${
        bulkInventoryEditMode
          ? `<label class="sr-only" for="category-${item._id}">Category for ${h(item.name)}</label><select id="category-${item._id}" class="item-category-input" data-category="${item._id}">${categoryOptionsHtml(item.category)}</select>`
          : h(item.category)
      }</td>
      <td>
        <label class="sr-only" for="price-${item._id}">Price for ${h(item.name)}</label>
        <input id="price-${item._id}" class="price-input" data-price="${item._id}" type="number" min="0.01" step="0.01" value="${Number(item.price).toFixed(2)}">
      </td>
      <td>
        <label class="sr-only" for="sold-out-${item._id}">Sold out for ${h(item.name)}</label>
        <input id="sold-out-${item._id}" class="sold-out-checkbox" data-sold-out="${item._id}" type="checkbox"${item.soldOut ? " checked" : ""}>
      </td>
      <td>
        <label class="sr-only" for="photo-${item._id}">Replace photo for ${h(item.name)}</label>
        <input id="photo-${item._id}" class="photo-input" data-photo="${item._id}" type="file" accept="image/*">
      </td>
      <td>
        <div class="inventory-actions">
          <button type="button" data-update-item="${item._id}">Update</button>
          <button class="danger-button" type="button" data-delete-item="${item._id}">Delete</button>
        </div>
      </td>`;
    return tr;
  }));
  updateAdminLoadMoreButton();
}

// ── Render orders ─────────────────────────────────────────────────────────────
function renderOrders() {
  const orders = showArchived
    ? allOrders.filter((o) => o.archived)
    : allOrders.filter((o) => !o.archived);

  els.orderCount.textContent = `${orders.length} ${orders.length === 1 ? "order" : "orders"}`;

  if (!orders.length) {
    els.orderList.innerHTML = `<div class="empty-state">${
      showArchived ? "No archived orders yet." : "No active orders have been sent yet."
    }</div>`;
    return;
  }

  els.orderList.replaceChildren(...orders.map((order) => {
    const card       = document.createElement("details");
    card.className   = "order-card";
    card.dataset.orderId = order._id;
    const sentAt     = new Date(order.createdAt).toLocaleString();
    const isRead     = Boolean(order.readAt);
    const orderStatus = order.orderStatus || "New";

    const stepperHtml = ORDER_STATUSES.map((s) => {
      const isActive = orderStatus === s;
      const isDone   = ORDER_STATUSES.indexOf(s) < ORDER_STATUSES.indexOf(orderStatus);
      return `<button type="button" class="status-step${isActive ? " active" : ""}${isDone ? " done" : ""}" data-set-status="${order._id}:${s}">${s}</button>`;
    }).join("");

    card.innerHTML = `
      <summary class="order-card-head">
        <div>
          <h3>#${order._id.slice(-6).toUpperCase()}</h3>
          <p>${sentAt}</p>
        </div>
        <div class="order-pill-row">
          <span class="status-pill order-status-pill status-${orderStatus.toLowerCase()}">${orderStatus}</span>
          ${!isRead ? `<span class="status-pill unread-pill">Unread</span>` : ""}
          ${order.archived ? `<span class="status-pill read-pill">Archived</span>` : ""}
        </div>
      </summary>
      <div class="order-status-stepper">${stepperHtml}</div>
      <ul>
        ${order.items.map((i) =>
          `<li><span>${i.quantity} x ${h(i.name)}</span><strong>${money.format(i.lineTotal)}</strong></li>`
        ).join("")}
      </ul>
      <div class="cart-row grand-total">
        <strong>Total</strong>
        <strong>${money.format(order.total)}</strong>
      </div>
      <div class="order-customer">
        <p><strong>${h(order.customer?.name || "Customer")}</strong></p>
        <p>${h(order.customer?.email || "")}${order.customer?.phone ? ` - ${h(order.customer.phone)}` : ""}</p>
        ${order.customer?.note ? `<p>${h(order.customer.note)}</p>` : ""}
      </div>
      <p class="helper-text">Sent to ${h(order.recipientEmail)}</p>
      <button class="ghost-button" type="button" data-archive-order="${order._id}">
        ${order.archived ? "Restore order" : "Archive order"}
      </button>`;
    return card;
  }));
}

// ── Full re-render ────────────────────────────────────────────────────────────
async function loadAndRender() {
  if (!currentStore?._id) {
    renderStoreUnavailable();
    return;
  }
  updateShopLink();
  els.adminStore.replaceChildren(option(currentStore._id, `${currentStore.name} - ${currentStore.location}`));

  try {
    const [assistantData] = await Promise.all([
      api.get(`/stores/${currentStore._id}/assistant-settings`),
    ]);
    assistantSettings = assistantData.settings || { notes: [], synonyms: [] };
    assistantFeedback = assistantData.feedback || [];
    fillAssistantLearningForm();
    renderAssistantFeedback();
    await Promise.all([loadOrders(), loadInventoryItems({ reset: true })]);
  } catch (err) {
    showToast(err.message || "Failed to load store data.");
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function unlockAdmin() {
  els.loadingPanel.classList.add("hidden");
  els.loginPanel.classList.add("hidden");
  els.content.classList.remove("hidden");
  els.logoutButton.classList.remove("hidden");

  // Load the store this admin manages
  const storeId = currentUserStoreId();
  if (!storeId) {
    renderStoreUnavailable();
    showToast("No store is assigned to this admin account.");
    return;
  }

  const storesData = await api.get("/stores");
  currentStore = storesData.stores.find((s) => s._id === storeId || s.id === storeId) || null;
  if (!currentStore) {
    try {
      const storeData = await api.get(`/stores/${storeId}`);
      currentStore = storeData.store;
    } catch {
      renderStoreUnavailable("The assigned store could not be loaded.");
      showToast("The assigned store could not be loaded.");
      return;
    }
  }

  if (currentUser.mustChangePassword) {
    setTimeout(() => els.changePasswordModal.showModal(), 320);
    return;
  }

  await loadAndRender();
}

async function logoutAdmin() {
  try {
    await api.post("/auth/logout", {});
  } catch {
    // The session may already be gone; still reset the local UI.
  }
  currentUser = null;
  currentStore = null;
  allItems = [];
  allOrders = [];
  itemOffset = 0;
  itemTotal = 0;
  assistantSettings = { notes: [], synonyms: [] };
  assistantFeedback = [];
  els.loadingPanel.classList.add("hidden");
  els.content.classList.add("hidden");
  els.loginPanel.classList.remove("hidden");
  els.logoutButton.classList.add("hidden");
  els.loginForm.reset();
  showToast("Logged out.");
}

els.logoutButton.addEventListener("click", logoutAdmin);

els.shopLink.addEventListener("click", async (event) => {
  if (!currentStore?._id) return;
  event.preventDefault();

  try {
    const data = await api.get(`/stores/${currentStore._id}`);
    currentStore = data.store;
    updateShopLink();
    window.location.href = storeHref();
  } catch (err) {
    showToast(err.message || "Failed to open the latest shop URL.");
  }
});

els.forgotPasswordButton.addEventListener("click", () => {
  const loginEmail = new FormData(els.loginForm).get("email") || "";
  els.forgotPasswordEmail.value = loginEmail;
  els.forgotPasswordMessage.classList.add("hidden");
  els.forgotPasswordModal.showModal();
});

els.forgotPasswordCancel.addEventListener("click", () => {
  els.forgotPasswordModal.close();
});

els.forgotPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.forgotPasswordMessage.classList.add("hidden");
  const email = els.forgotPasswordEmail.value.trim().toLowerCase();
  try {
    const data = await api.post("/auth/forgot-password", { email });
    showFormMessage(els.forgotPasswordMessage, data.message, false);
    els.forgotPasswordModal.close();
    els.forgotPasswordForm.reset();
    showToast("Password reset email sent if the account exists.");
  } catch (err) {
    showFormMessage(els.forgotPasswordMessage, err.message || "Failed to send reset email.");
  }
});

els.resetPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.resetPasswordMessage.classList.add("hidden");
  const newPassword = els.resetNewPassword.value;

  if (newPassword.length < 8) {
    showFormMessage(els.resetPasswordMessage, "Password must be at least 8 characters.");
    return;
  }

  try {
    const data = await api.post("/auth/reset-password", { token: resetToken, newPassword });
    els.resetPasswordModal.close();
    els.resetPasswordForm.reset();
    history.replaceState({}, "", location.pathname);
    showToast(data.message);
  } catch (err) {
    showFormMessage(els.resetPasswordMessage, err.message || "Failed to reset password.");
  }
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api.post("/auth/login", {
      email:    form.get("email").trim().toLowerCase(),
      password: form.get("password"),
    });
    if (data.user.role !== "store-admin") {
      showToast("This login is for store admins only.");
      await api.post("/auth/logout", {});
      return;
    }
    currentUser = data.user;
    await unlockAdmin();
  } catch (err) {
    showToast(err.message || "Invalid email or password.");
  }
});

// ── Change password ───────────────────────────────────────────────────────────
els.changePasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const newPw     = els.newPassword.value;
  const confirmPw = els.confirmPassword.value;

  els.passwordError.classList.add("hidden");

  if (newPw.length < 8) {
    els.passwordError.textContent = "Password must be at least 8 characters.";
    els.passwordError.classList.remove("hidden");
    return;
  }
  if (newPw !== confirmPw) {
    els.passwordError.textContent = "Passwords don't match. Please try again.";
    els.passwordError.classList.remove("hidden");
    els.confirmPassword.value = "";
    els.confirmPassword.focus();
    return;
  }

  try {
    await api.post("/auth/change-password", {
      newPassword:     newPw,
    });
    currentUser.mustChangePassword = false;
    els.changePasswordModal.close();
    els.changePasswordForm.reset();
    await loadAndRender();
    showToast("Password updated successfully. Keep it safe!");
  } catch (err) {
    els.passwordError.textContent = err.message || "Failed to change password.";
    els.passwordError.classList.remove("hidden");
  }
});

// ── Storefront banner ─────────────────────────────────────────────────────────
els.heroForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentStore) return;

  const form = new FormData(event.currentTarget);
  try {
    const data = await api.patch(`/stores/${currentStore._id}`, {
      hero: {
        eyebrow: form.get("heroEyebrow"),
        headline: form.get("heroHeadline"),
        subheading: form.get("heroSubheading"),
        detail: form.get("heroDetail"),
      },
    });
    currentStore = data.store;
    fillHeroForm();
    showToast("Storefront banner saved.");
  } catch (err) {
    showToast(err.message || "Failed to save storefront banner.");
  }
});

els.heroResetButton.addEventListener("click", async () => {
  if (!currentStore) return;
  try {
    const data = await api.patch(`/stores/${currentStore._id}`, {
      hero: { eyebrow: "", headline: "", subheading: "", detail: "" },
    });
    currentStore = data.store;
    fillHeroForm();
    showToast("Storefront banner reset.");
  } catch (err) {
    showToast(err.message || "Failed to reset storefront banner.");
  }
});

els.orderSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentStore) return;

  try {
    const data = await api.patch(`/stores/${currentStore._id}`, {
      orderEmailOtpRequired: els.orderEmailOtpRequired.checked,
    });
    currentStore = data.store;
    fillOrderSettings();
    showToast("Order settings saved.");
  } catch (err) {
    showToast(err.message || "Failed to save order settings.");
  }
});

els.assistantLearningForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentStore) return;

  const submitButton = els.assistantLearningForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  try {
    const data = await api.patch(`/stores/${currentStore._id}/assistant-settings`, {
      notes: parseAssistantNotes(els.assistantNotes.value),
      synonyms: parseAssistantSynonyms(els.assistantSynonyms.value),
    });
    assistantSettings = data.settings || { notes: [], synonyms: [] };
    fillAssistantLearningForm();
    showToast("Assistant learning saved.");
  } catch (err) {
    showToast(err.message || "Failed to save assistant learning.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save assistant learning";
  }
});

// ── Category filter ───────────────────────────────────────────────────────────
els.inventoryCategoryFilter.addEventListener("change", () => {
  selectedCategory = els.inventoryCategoryFilter.value;
  bulkInventoryEditMode = false;
  loadInventoryItems({ reset: true });
});

els.loadMoreItems.addEventListener("click", () => loadInventoryItems());

els.showArchivedOrders.addEventListener("change", async () => {
  showArchived = els.showArchivedOrders.checked;
  try {
    await loadOrders();
  } catch (err) {
    showToast(err.message || "Failed to load orders.");
  }
});

els.adminCategoryList.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("[data-remove-category]");
  if (!button) return;
  if (!hasCurrentStore()) return;

  const category = button.dataset.removeCategory;
  if (!category) return;

  if (currentStore.categories.length <= 1) {
    showToast("Keep at least one category in the store.");
    return;
  }

  const hasItems = allItems.some((item) => item.category === category);
  if (hasItems) {
    showToast("Move or delete items in this category before removing it.");
    return;
  }

  const confirmed = window.confirm(`Remove "${category}" from this store?`);
  if (!confirmed) return;

  button.disabled = true;
  try {
    const data = await api.patch(`/stores/${currentStore._id}`, {
      categories: currentStore.categories.filter((c) => c !== category),
    });
    currentStore = data.store;
    if (selectedCategory === category) selectedCategory = "all";
    await loadInventoryItems({ reset: true });
    showToast("Category removed.");
  } catch (err) {
    button.disabled = false;
    showToast(err.message || "Failed to remove category.");
  }
});

// ── Add category ──────────────────────────────────────────────────────────────
document.querySelector("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasCurrentStore()) return;

  const formEl   = event.currentTarget;
  const form     = new FormData(formEl);
  const category = form.get("categoryName").trim();
  if (!category) return;

  if (currentStore.categories.includes(category)) {
    selectedCategory = category;
    renderInventory();
    showToast("That category already exists.");
    return;
  }

  try {
    const data = await api.patch(`/stores/${currentStore._id}`, {
      categories: [...currentStore.categories, category],
    });
    currentStore = data.store;
    selectedCategory = category;
    formEl.reset();
    await loadInventoryItems({ reset: true });
    els.itemCategory.value = category;
    showToast("Category added.");
  } catch (err) {
    showToast(err.message || "Failed to add category.");
  }
});

// ── Add item ──────────────────────────────────────────────────────────────────
document.querySelector("#item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasCurrentStore()) return;

  const formEl  = event.currentTarget;
  const formData = new FormData(formEl);
  const name     = formData.get("itemName").trim();
  const category = formData.get("itemCategory");
  const price    = Number(formData.get("price"));

  if (!name)               { showToast("Please enter an item name."); return; }
  if (!price || price <= 0){ showToast("Please enter a valid price."); return; }

  const photoFile = formData.get("photo");
  let photoDataUrl = null;
  if (photoFile instanceof File && photoFile.size > 0) {
    if (photoFile.size > MAX_PHOTO_BYTES) {
      showToast(`Photo must be ${MAX_PHOTO_LABEL} or smaller.`);
      return;
    }
    if (!photoFile.type.startsWith("image/")) {
      showToast("Photo must be an image file.");
      return;
    }
    photoDataUrl = await fileToDataUrl(photoFile);
  }

  try {
    await api.post(`/stores/${currentStore._id}/items`, { name, category, price, photoDataUrl });
    selectedCategory = category;
    formEl.reset();
    await loadInventoryItems({ reset: true });
    showItemSuccess(`"${name}" added to ${category}.`);
  } catch (err) {
    showToast(err.message || "Failed to add item.");
  }
});

// ── Bulk item upload ─────────────────────────────────────────────────────────
els.bulkItemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.bulkItemMessage.classList.add("hidden");

  if (!hasCurrentStore("No store is assigned to this admin account.")) {
    showFormMessage(els.bulkItemMessage, "No store is assigned to this admin account.");
    return;
  }

  const file = els.bulkItemFile.files[0];
  if (!file) {
    showFormMessage(els.bulkItemMessage, "Please choose a CSV file.");
    return;
  }

  const submitButton = els.bulkItemForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Uploading...";

  try {
    const items = parseBulkItems(await file.text());
    const data = await api.post(`/stores/${currentStore._id}/items/bulk`, { items });
    if (data.categories) currentStore = { ...currentStore, categories: data.categories };
    selectedCategory = "all";
    els.bulkItemForm.reset();
    await loadInventoryItems({ reset: true });
    showFormMessage(
      els.bulkItemMessage,
      `Imported ${items.length} ${items.length === 1 ? "item" : "items"}.`,
      false
    );
    showToast(`Imported ${items.length} ${items.length === 1 ? "item" : "items"}.`);
  } catch (err) {
    showFormMessage(els.bulkItemMessage, err.message || "Failed to upload item list.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Upload item list";
  }
});

function itemUpdatePayload(id) {
  const item = allItems.find((candidate) => candidate._id === id);
  const nameInput = els.inventoryBody.querySelector(`[data-name="${id}"]`);
  const categoryInput = els.inventoryBody.querySelector(`[data-category="${id}"]`);
  const priceInput = els.inventoryBody.querySelector(`[data-price="${id}"]`);
  const photoInput = els.inventoryBody.querySelector(`[data-photo="${id}"]`);
  const soldOutInput = els.inventoryBody.querySelector(`[data-sold-out="${id}"]`);
  const nextName = String(nameInput?.value ?? item?.name ?? "").trim();
  const nextCategory = String(categoryInput?.value ?? item?.category ?? "").trim();
  const nextPrice = Number(priceInput.value);

  if (!nextName) throw new Error("Enter an item name before updating.");
  if (!nextCategory) throw new Error("Choose a category before updating.");
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new Error("Enter a valid price before updating.");
  }

  const photoFile = photoInput.files[0];
  if (photoFile) {
    if (!photoFile.type.startsWith("image/")) throw new Error("Replacement photo must be an image file.");
  }

  return {
    name: nextName,
    category: nextCategory,
    price: nextPrice,
    soldOut: soldOutInput.checked,
    photoFile,
  };
}

function hasItemChanges(item, payload) {
  return (
    payload.name !== item.name ||
    payload.category !== item.category ||
    Number(payload.price) !== Number(item.price) ||
    Boolean(payload.soldOut) !== Boolean(item.soldOut) ||
    Boolean(payload.photoFile)
  );
}

async function saveItemUpdate(id, payload = itemUpdatePayload(id)) {
  if (!hasCurrentStore()) throw new Error("No store is assigned to this admin account.");
  const path = `/stores/${currentStore._id}/items/${id}`;
  let photoDataUrl = null;
  if (payload.photoFile && payload.photoFile.size > MAX_PHOTO_BYTES) {
    throw new Error(`Photo must be ${MAX_PHOTO_LABEL} or smaller.`);
  }
  if (payload.photoFile) {
    photoDataUrl = await fileToDataUrl(payload.photoFile);
  }

  await api.patch(path, {
    name: payload.name,
    category: payload.category,
    price: payload.price,
    soldOut: payload.soldOut,
  });

  if (payload.photoFile) {
    return api.post(`${path}/photo`, { photoDataUrl });
  }
}

els.bulkInventoryEdit.addEventListener("click", () => {
  bulkInventoryEditMode = !bulkInventoryEditMode;
  renderInventory();
});

els.bulkInventorySave.addEventListener("click", async () => {
  if (!hasCurrentStore()) return;

  const updates = visibleInventoryItems()
    .map((item) => ({ item, payload: itemUpdatePayload(item._id) }))
    .filter(({ item, payload }) => hasItemChanges(item, payload));

  if (!updates.length) {
    showToast("No inventory changes to save.");
    return;
  }

  els.bulkInventorySave.disabled = true;
  els.bulkInventorySave.textContent = "Saving...";

  try {
    for (const { item, payload } of updates) {
      await saveItemUpdate(item._id, payload);
    }
    bulkInventoryEditMode = false;
    await loadInventoryItems({ reset: true });
    showToast(`Saved ${updates.length} changed ${updates.length === 1 ? "item" : "items"}.`);
  } catch (err) {
    showToast(err.message || "Failed to save inventory updates.");
  } finally {
    els.bulkInventorySave.textContent = "Bulk save";
    renderInventory();
  }
});

// ── Update / delete item ──────────────────────────────────────────────────────
els.inventoryBody.addEventListener("click", async (event) => {
  const updateBtn = event.target.closest("[data-update-item]");
  const deleteBtn = event.target.closest("[data-delete-item]");

  if (updateBtn) {
    const id = updateBtn.dataset.updateItem;

    try {
      await saveItemUpdate(id);
      await loadInventoryItems({ reset: true });
      showToast("Item updated.");
    } catch (err) {
      showToast(err.message || "Failed to update item.");
    }
  }

  if (deleteBtn) {
    const id = deleteBtn.dataset.deleteItem;
    try {
      await api.delete(`/stores/${currentStore._id}/items/${id}`);
      await loadInventoryItems({ reset: true });
      showToast("Item deleted.");
    } catch (err) {
      showToast(err.message || "Failed to delete item.");
    }
  }
});

// ── Order: mark read on expand ────────────────────────────────────────────────
els.orderList.addEventListener("toggle", async (event) => {
  const card = event.target.closest("[data-order-id]");
  if (!card || !card.open) return;
  const order = allOrders.find((o) => o._id === card.dataset.orderId);
  if (!order || order.readAt) return;
  try {
    const data = await api.patch(`/stores/${currentStore._id}/orders/${order._id}`, { markRead: true });
    order.readAt = data.order.readAt;
    // Update unread pill inline
    card.querySelector(".unread-pill")?.remove();
  } catch { /* non-critical */ }
}, true);

// ── Order: status stepper + archive ──────────────────────────────────────────
els.orderList.addEventListener("click", async (event) => {
  const archiveBtn = event.target.closest("[data-archive-order]");
  const statusBtn  = event.target.closest("[data-set-status]");

  if (archiveBtn) {
    const order = allOrders.find((o) => o._id === archiveBtn.dataset.archiveOrder);
    if (!order) return;
    try {
      const data = await api.patch(`/stores/${currentStore._id}/orders/${order._id}`, {
        archived: !order.archived,
      });
      order.archived = data.order.archived;
      renderOrders();
      showToast(order.archived ? "Order archived." : "Order restored.");
    } catch (err) {
      showToast(err.message || "Failed to update order.");
    }
  }

  if (statusBtn) {
    const [orderId, newStatus] = statusBtn.dataset.setStatus.split(":");
    const order = allOrders.find((o) => o._id === orderId);
    if (!order) return;
    try {
      const data = await api.patch(`/stores/${currentStore._id}/orders/${orderId}`, {
        orderStatus: newStatus,
        markRead:    true,
      });
      order.orderStatus = data.order.orderStatus;
      order.readAt      = data.order.readAt;
      // Update stepper inline
      const card = statusBtn.closest(".order-card");
      card.querySelectorAll(".status-step").forEach((btn) => {
        const s = btn.dataset.setStatus.split(":")[1];
        btn.className = "status-step"
          + (s === newStatus ? " active" : "")
          + (ORDER_STATUSES.indexOf(s) < ORDER_STATUSES.indexOf(newStatus) ? " done" : "");
      });
      const pill = card.querySelector(".order-status-pill");
      if (pill) {
        ORDER_STATUSES.forEach((s) => pill.classList.remove(`status-${s.toLowerCase()}`));
        pill.classList.add(`status-${newStatus.toLowerCase()}`);
        pill.textContent = newStatus;
      }
      showToast(`Order marked as "${newStatus}".`);
    } catch (err) {
      showToast(err.message || "Failed to update order status.");
    }
  }
});

// ── Boot — restore session or show login ──────────────────────────────────────
async function boot() {
  if (resetToken) {
    els.loadingPanel.classList.add("hidden");
    els.loginPanel.classList.remove("hidden");
    els.resetPasswordModal.showModal();
    return;
  }

  try {
    const data = await api.get("/auth/me");
    currentUser = data.user;
    await unlockAdmin();
  } catch {
    els.loadingPanel.classList.add("hidden");
    els.loginPanel.classList.remove("hidden");
  }
}

boot();
