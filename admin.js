const state = loadState();
let activeAdminEmail = sessionStorage.getItem("freshcart-store-admin-email") || freshCartOwnerEmail;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const els = {
  loginPanel: document.querySelector("#admin-login-panel"),
  content: document.querySelector("#admin-content"),
  loginForm: document.querySelector("#admin-login-form"),
  shopLink: document.querySelector("#admin-shop-link"),
  adminStore: document.querySelector("#admin-store"),
  itemCategory: document.querySelector("#item-category"),
  inventoryCategoryFilter: document.querySelector("#inventory-category-filter"),
  adminCategoryList: document.querySelector("#admin-category-list"),
  inventoryBody: document.querySelector("#inventory-body"),
  inventoryCount: document.querySelector("#inventory-count"),
  orderList: document.querySelector("#order-list"),
  orderCount: document.querySelector("#order-count"),
  showArchivedOrders: document.querySelector("#show-archived-orders"),
  toast: document.querySelector("#toast"),
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function renderAdminStore() {
  const ownerStores = state.stores.filter((store) => store.ownerEmail === activeAdminEmail);
  els.adminStore.replaceChildren(
    ...ownerStores.map((store) => option(store.id, `${store.name} - ${store.location}`))
  );
  if (!ownerStores.some((store) => store.id === state.selectedAdminStore)) {
    state.selectedAdminStore = ownerStores[0]?.id;
  }
  els.adminStore.value = state.selectedAdminStore;
  if (state.selectedAdminStore) els.shopLink.href = storePageUrl(state.selectedAdminStore);
}

function renderAdmin() {
  renderAdminStore();
  const currentStore = getStore(state, state.selectedAdminStore);
  if (!currentStore) {
    els.content.innerHTML = `<section class="panel auth-panel"><h2>No store assigned</h2><p class="helper-text">Ask the super admin to assign this account to a store.</p></section>`;
    return;
  }

  els.itemCategory.replaceChildren(...currentStore.categories.map((category) => option(category, category)));
  els.inventoryCategoryFilter.replaceChildren(
    option("all", "All categories"),
    ...currentStore.categories.map((category) => option(category, category))
  );
  if (!currentStore.categories.includes(state.selectedInventoryCategory)) {
    state.selectedInventoryCategory = "all";
  }
  els.inventoryCategoryFilter.value = state.selectedInventoryCategory;

  els.adminCategoryList.replaceChildren(
    ...currentStore.categories.map((category) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = category;
      return chip;
    })
  );

  const rows = state.items
    .filter((item) => {
      const storeMatch = item.storeId === currentStore.id;
      const categoryMatch =
        state.selectedInventoryCategory === "all" || item.category === state.selectedInventoryCategory;
      return storeMatch && categoryMatch;
    })
    .map((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><img class="inventory-photo" src="${item.photo}" alt="${item.name}"></td>
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>
          <label class="sr-only" for="price-${item.id}">Price for ${item.name}</label>
          <input id="price-${item.id}" class="price-input" data-price="${item.id}" type="number" min="0.01" step="0.01" value="${Number(item.price).toFixed(2)}">
        </td>
        <td>
          <label class="sr-only" for="sold-out-${item.id}">Sold out for ${item.name}</label>
          <input id="sold-out-${item.id}" class="sold-out-checkbox" data-sold-out="${item.id}" type="checkbox"${item.soldOut ? " checked" : ""}>
        </td>
        <td>
          <label class="sr-only" for="photo-${item.id}">Replace photo for ${item.name}</label>
          <input id="photo-${item.id}" class="photo-input" data-photo="${item.id}" type="file" accept="image/*">
        </td>
        <td>
          <div class="inventory-actions">
            <button type="button" data-update-item="${item.id}">Update</button>
            <button class="danger-button" type="button" data-delete-item="${item.id}">Delete</button>
          </div>
        </td>
      `;
      return tr;
    });

  if (rows.length) {
    els.inventoryBody.replaceChildren(...rows);
  } else {
    els.inventoryBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No items in this category yet.</div></td></tr>`;
  }
  els.inventoryCount.textContent = `${rows.length} ${rows.length === 1 ? "item" : "items"}`;
  renderOrders(currentStore);
  saveState(state);
}

function renderOrders(currentStore) {
  const showArchived = els.showArchivedOrders.checked;
  const storeOrders = state.orders.filter((order) => order.storeId === currentStore.id);
  const orders = storeOrders.filter((order) => (showArchived ? order.archived : !order.archived));
  els.orderCount.textContent = `${orders.length} ${orders.length === 1 ? "order" : "orders"}`;

  if (!orders.length) {
    els.orderList.innerHTML = `<div class="empty-state">${
      showArchived ? "No archived orders yet." : "No active orders have been sent yet."
    }</div>`;
    return;
  }

  els.orderList.replaceChildren(
    ...orders.map((order) => {
      const card = document.createElement("details");
      card.className = "order-card";
      card.dataset.orderId = order.id;
      const sentAt = new Date(order.createdAt).toLocaleString();
      const isRead = Boolean(order.readAt);
      const status = isRead ? "Read" : "Unread";
      card.innerHTML = `
        <summary class="order-card-head">
          <div>
            <h3>${order.id}</h3>
            <p>${sentAt}</p>
          </div>
          <div class="order-pill-row">
            <span class="status-pill ${isRead ? "read-pill" : "unread-pill"}">${status}</span>
            ${order.archived ? `<span class="status-pill read-pill">Archived</span>` : ""}
          </div>
        </summary>
        <ul>
          ${order.items
            .map(
              (item) =>
                `<li><span>${item.quantity} x ${item.name}</span><strong>${money.format(item.lineTotal)}</strong></li>`
            )
            .join("")}
        </ul>
        <div class="cart-row grand-total">
          <strong>Total</strong>
          <strong>${money.format(order.total)}</strong>
        </div>
        <p class="helper-text">Sent to ${order.recipientEmail}</p>
        <button class="ghost-button" type="button" data-archive-order="${order.id}">${
          order.archived ? "Restore order" : "Archive order"
        }</button>
      `;
      return card;
    })
  );
}

els.orderList.addEventListener("toggle", (event) => {
  const orderCard = event.target.closest("[data-order-id]");
  if (!orderCard || !orderCard.open) return;
  const order = state.orders.find((item) => item.id === orderCard.dataset.orderId);
  if (!order || order.readAt) return;
  order.readAt = new Date().toISOString();
  order.status = "Read";
  const pill = orderCard.querySelector(".status-pill");
  if (pill) {
    pill.textContent = "Read";
    pill.classList.remove("unread-pill");
    pill.classList.add("read-pill");
  }
  saveState(state);
}, true);

els.orderList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-archive-order]");
  if (!button) return;
  const order = state.orders.find((item) => item.id === button.dataset.archiveOrder);
  if (!order) return;
  order.archived = !order.archived;
  saveState(state);
  renderAdmin();
  showToast(order.archived ? "Order archived." : "Order restored.");
});

els.showArchivedOrders.addEventListener("change", renderAdmin);

function unlockAdmin() {
  els.loginPanel.classList.add("hidden");
  els.content.classList.remove("hidden");
  renderAdmin();
}

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = form.get("email").trim().toLowerCase();
  if (checkLogin("store", email, form.get("password"))) {
    sessionStorage.setItem("freshcart-store-admin", "true");
    sessionStorage.setItem("freshcart-store-admin-email", email);
    activeAdminEmail = email;
    unlockAdmin();
  } else {
    showToast("Invalid store admin email or password.");
  }
});

els.adminStore.addEventListener("change", () => {
  state.selectedAdminStore = els.adminStore.value;
  state.selectedInventoryCategory = "all";
  renderAdmin();
});

els.inventoryCategoryFilter.addEventListener("change", () => {
  state.selectedInventoryCategory = els.inventoryCategoryFilter.value;
  renderAdmin();
});

document.querySelector("#category-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const store = getStore(state, state.selectedAdminStore);
  const form = new FormData(event.currentTarget);
  const category = form.get("categoryName").trim();
  if (store && category && !store.categories.includes(category)) {
    store.categories.push(category);
    state.selectedInventoryCategory = category;
    event.currentTarget.reset();
    renderAdmin();
    els.itemCategory.value = category;
    showToast("Category added.");
  } else if (store && category) {
    state.selectedInventoryCategory = category;
    renderAdmin();
    els.itemCategory.value = category;
    showToast("That category already exists.");
  }
});

document.querySelector("#item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const photoFile = form.get("photo");
  if (!(photoFile instanceof File) || !photoFile.type.startsWith("image/")) {
    showToast("Please upload an image file for the item.");
    return;
  }

  const name = form.get("itemName").trim();
  const category = form.get("itemCategory");
  state.items.push({
    id: `${slugify(name)}-${Date.now()}`,
    storeId: state.selectedAdminStore,
    name,
    category,
    price: Number(form.get("price")),
    photo: await fileToDataUrl(photoFile),
    soldOut: false,
  });
  state.selectedInventoryCategory = category;
  event.currentTarget.reset();
  renderAdmin();
  showToast("Item added to the store.");
});

els.inventoryBody.addEventListener("click", async (event) => {
  const updateButton = event.target.closest("[data-update-item]");
  const deleteButton = event.target.closest("[data-delete-item]");

  if (updateButton) {
    const id = updateButton.dataset.updateItem;
    const item = state.items.find((product) => product.id === id);
    if (!item) return;

    const priceInput = els.inventoryBody.querySelector(`[data-price="${id}"]`);
    const photoInput = els.inventoryBody.querySelector(`[data-photo="${id}"]`);
    const soldOutInput = els.inventoryBody.querySelector(`[data-sold-out="${id}"]`);
    const nextPrice = Number(priceInput.value);

    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      showToast("Enter a valid price before updating.");
      return;
    }

    const photoFile = photoInput.files[0];
    if (photoFile) {
      if (!photoFile.type.startsWith("image/")) {
        showToast("Replacement photo must be an image file.");
        return;
      }
      item.photo = await fileToDataUrl(photoFile);
    }

    item.price = nextPrice;
    item.soldOut = soldOutInput.checked;
    if (item.soldOut) delete state.cart[id];
    renderAdmin();
    showToast("Item updated.");
  }

  if (deleteButton) {
    const id = deleteButton.dataset.deleteItem;
    state.items = state.items.filter((item) => item.id !== id);
    delete state.cart[id];
    renderAdmin();
    showToast("Item deleted.");
  }
});

if (sessionStorage.getItem("freshcart-store-admin") === "true") {
  unlockAdmin();
}
