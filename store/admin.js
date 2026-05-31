/**
 * admin.js — store admin dashboard, wired to the FreshCart API.
 * Depends on: api.js (loaded before this script in admin.html)
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser  = null;   // populated from GET /api/auth/me
let currentStore = null;   // the store this admin manages
let allItems     = [];     // items for current store
let allOrders    = [];     // orders for current store
let selectedCategory        = "all";
let showArchived             = false;
const resetToken = new URLSearchParams(window.location.search).get("resetToken");

const ORDER_STATUSES = ["New", "Preparing", "Ready", "Fulfilled"];
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

function h(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const els = {
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
  resetConfirmPassword:   document.querySelector("#reset-confirm-password"),
  resetPasswordMessage:   document.querySelector("#reset-password-message"),
  shopLink:               document.querySelector("#admin-shop-link"),
  adminStore:             document.querySelector("#admin-store"),
  heroForm:               document.querySelector("#hero-form"),
  heroResetButton:        document.querySelector("#hero-reset-button"),
  itemCategory:           document.querySelector("#item-category"),
  inventoryCategoryFilter:document.querySelector("#inventory-category-filter"),
  adminCategoryList:      document.querySelector("#admin-category-list"),
  inventoryBody:          document.querySelector("#inventory-body"),
  inventoryCount:         document.querySelector("#inventory-count"),
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

// ── Render inventory ──────────────────────────────────────────────────────────
function renderInventory() {
  if (!currentStore) return;
  fillHeroForm();

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

  const filtered = selectedCategory === "all"
    ? allItems
    : allItems.filter((i) => i.category === selectedCategory);

  els.inventoryCount.textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;

  if (!filtered.length) {
    els.inventoryBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No items in this category yet.</div></td></tr>`;
    return;
  }

  els.inventoryBody.replaceChildren(...filtered.map((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img class="inventory-photo" src="${h(item.photo)}" alt="${h(item.name)}"></td>
      <td>${h(item.name)}</td>
      <td>${h(item.category)}</td>
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
  if (!currentStore) return;
  els.shopLink.href = `store.html?id=${encodeURIComponent(currentStore.slug)}`;
  els.adminStore.replaceChildren(option(currentStore._id, `${currentStore.name} - ${currentStore.location}`));

  try {
    const [itemsData, ordersData] = await Promise.all([
      api.get(`/stores/${currentStore._id}/items`),
      api.get(`/stores/${currentStore._id}/orders`),
    ]);
    allItems  = itemsData.items;
    allOrders = ordersData.orders;
    renderInventory();
    renderOrders();
  } catch (err) {
    showToast(err.message || "Failed to load store data.");
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function unlockAdmin() {
  els.loginPanel.classList.add("hidden");
  els.content.classList.remove("hidden");
  els.logoutButton.classList.remove("hidden");

  // Load the store this admin manages
  const storesData = await api.get("/stores");
  currentStore = storesData.stores.find((s) => s._id === currentUser.storeId?.toString()
    || s._id === currentUser.storeId);

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
  els.content.classList.add("hidden");
  els.loginPanel.classList.remove("hidden");
  els.logoutButton.classList.add("hidden");
  els.loginForm.reset();
  showToast("Logged out.");
}

els.logoutButton.addEventListener("click", logoutAdmin);

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
  const confirmPassword = els.resetConfirmPassword.value;

  if (newPassword.length < 8) {
    showFormMessage(els.resetPasswordMessage, "Password must be at least 8 characters.");
    return;
  }
  if (newPassword !== confirmPassword) {
    showFormMessage(els.resetPasswordMessage, "Passwords do not match.");
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

// ── Category filter ───────────────────────────────────────────────────────────
els.inventoryCategoryFilter.addEventListener("change", () => {
  selectedCategory = els.inventoryCategoryFilter.value;
  renderInventory();
});

els.showArchivedOrders.addEventListener("change", () => {
  showArchived = els.showArchivedOrders.checked;
  renderOrders();
});

els.adminCategoryList.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("[data-remove-category]");
  if (!button) return;

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
    renderInventory();
    showToast("Category removed.");
  } catch (err) {
    button.disabled = false;
    showToast(err.message || "Failed to remove category.");
  }
});

// ── Add category ──────────────────────────────────────────────────────────────
document.querySelector("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
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
    renderInventory();
    els.itemCategory.value = category;
    showToast("Category added.");
  } catch (err) {
    showToast(err.message || "Failed to add category.");
  }
});

// ── Add item ──────────────────────────────────────────────────────────────────
document.querySelector("#item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formEl  = event.currentTarget;
  const formData = new FormData(formEl);
  const name     = formData.get("itemName").trim();
  const category = formData.get("itemCategory");
  const price    = Number(formData.get("price"));

  if (!name)               { showToast("Please enter an item name."); return; }
  if (!price || price <= 0){ showToast("Please enter a valid price."); return; }

  // Build multipart form for API (handles optional photo)
  const body = new FormData();
  body.append("name",     name);
  body.append("category", category);
  body.append("price",    price);
  const photoFile = formData.get("photo");
  if (photoFile instanceof File && photoFile.size > 0) body.append("photo", photoFile);

  try {
    await api.postForm(`/stores/${currentStore._id}/items`, body);
    selectedCategory = category;
    formEl.reset();
    await loadAndRender();
    showItemSuccess(`"${name}" added to ${category}.`);
  } catch (err) {
    showToast(err.message || "Failed to add item.");
  }
});

// ── Update / delete item ──────────────────────────────────────────────────────
els.inventoryBody.addEventListener("click", async (event) => {
  const updateBtn = event.target.closest("[data-update-item]");
  const deleteBtn = event.target.closest("[data-delete-item]");

  if (updateBtn) {
    const id         = updateBtn.dataset.updateItem;
    const priceInput = els.inventoryBody.querySelector(`[data-price="${id}"]`);
    const photoInput = els.inventoryBody.querySelector(`[data-photo="${id}"]`);
    const soldOutInput = els.inventoryBody.querySelector(`[data-sold-out="${id}"]`);
    const nextPrice  = Number(priceInput.value);

    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      showToast("Enter a valid price before updating.");
      return;
    }

    const body = new FormData();
    body.append("price",   nextPrice);
    body.append("soldOut", soldOutInput.checked);
    const photoFile = photoInput.files[0];
    if (photoFile) {
      if (!photoFile.type.startsWith("image/")) { showToast("Replacement photo must be an image file."); return; }
      body.append("photo", photoFile);
    }

    try {
      await api.patchForm(`/stores/${currentStore._id}/items/${id}`, body);
      await loadAndRender();
      showToast("Item updated.");
    } catch (err) {
      showToast(err.message || "Failed to update item.");
    }
  }

  if (deleteBtn) {
    const id = deleteBtn.dataset.deleteItem;
    try {
      await api.delete(`/stores/${currentStore._id}/items/${id}`);
      await loadAndRender();
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
    els.resetPasswordModal.showModal();
    return;
  }

  try {
    const data = await api.get("/auth/me");
    currentUser = data.user;
    await unlockAdmin();
  } catch {
    // Not logged in — show login panel (already visible by default)
  }
}

boot();
