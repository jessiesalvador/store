const state = loadState();
const params = new URLSearchParams(window.location.search);
const storeId = params.get("store") || "green-valley";
const store = getStore(state, storeId);
let selectedCategory = "all";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const els = {
  pageName: document.querySelector("#store-page-name"),
  location: document.querySelector("#store-location"),
  search: document.querySelector("#store-search-input"),
  categoryFilters: document.querySelector("#store-category-filters"),
  productGrid: document.querySelector("#store-product-grid"),
  resultCount: document.querySelector("#store-result-count"),
  cartItems: document.querySelector("#store-cart-items"),
  cartCount: document.querySelector("#store-cart-count"),
  subtotal: document.querySelector("#store-subtotal"),
  grandTotal: document.querySelector("#store-grand-total"),
  sendOrderButton: document.querySelector("#store-send-order-button"),
  toast: document.querySelector("#toast"),
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function storeItems() {
  if (!store) return [];
  const term = els.search.value.trim().toLowerCase();
  return state.items.filter((item) => {
    const storeMatch = item.storeId === store.id;
    const categoryMatch = selectedCategory === "all" || item.category === selectedCategory;
    const termMatch =
      !term || item.name.toLowerCase().includes(term) || item.category.toLowerCase().includes(term);
    return storeMatch && categoryMatch && termMatch;
  });
}

function createCategoryChip(value, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `category-chip${selectedCategory === value ? " active" : ""}`;
  button.dataset.category = value;
  button.setAttribute("aria-pressed", String(selectedCategory === value));
  const count =
    value === "all"
      ? storeItems().length
      : state.items.filter((item) => item.storeId === store.id && item.category === value).length;
  button.innerHTML = `<span>${label}</span><strong>${count}</strong>`;
  return button;
}

function renderCategories() {
  if (!store) return;
  if (!store.categories.includes(selectedCategory)) selectedCategory = "all";
  els.categoryFilters.replaceChildren(
    createCategoryChip("all", "All categories"),
    ...store.categories.map((category) => createCategoryChip(category, category))
  );
}

function renderProducts() {
  const products = storeItems();
  els.resultCount.textContent = `${products.length} ${products.length === 1 ? "item" : "items"}`;
  if (!products.length) {
    els.productGrid.innerHTML = `<div class="empty-state">No groceries match those filters.</div>`;
    return;
  }

  els.productGrid.replaceChildren(
    ...products.map((item) => {
      const card = document.createElement("article");
      card.className = "product-card";
      card.innerHTML = `
        <img src="${item.photo}" alt="${item.name}" loading="lazy">
        <div class="product-body">
          <div class="meta-row">
            <span class="tag">${item.category}</span>
          </div>
          <h3>${item.name}</h3>
          <div class="meta-row">
            <span class="price">${money.format(item.price)}</span>
            <button type="button" data-add="${item.id}"${item.soldOut ? " disabled" : ""}>${
              item.soldOut ? "Sold out" : "Add to cart"
            }</button>
          </div>
        </div>
      `;
      return card;
    })
  );
}

function cartEntries() {
  return Object.entries(state.cart)
    .map(([id, quantity]) => ({
      item: state.items.find((product) => product.id === id && product.storeId === store.id),
      quantity,
    }))
    .filter((entry) => entry.item && !entry.item.soldOut);
}

function cartTotal() {
  return cartEntries().reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0);
}

function renderCart() {
  const entries = cartEntries();
  const quantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  els.cartCount.textContent = String(quantity);

  if (!entries.length) {
    els.cartItems.innerHTML = `<div class="empty-state">Your cart is empty.</div>`;
  } else {
    els.cartItems.replaceChildren(
      ...entries.map(({ item, quantity }) => {
        const row = document.createElement("div");
        row.className = "cart-line";
        row.innerHTML = `
          <div class="cart-row">
            <strong>${item.name}</strong>
            <span>${money.format(item.price * quantity)}</span>
          </div>
          <div class="cart-row">
            <small>${store.name}</small>
            <div class="quantity-actions" aria-label="Quantity controls for ${item.name}">
              <button type="button" data-decrease="${item.id}" aria-label="Remove one ${item.name}">-</button>
              <strong>${quantity}</strong>
              <button type="button" data-increase="${item.id}" aria-label="Add one ${item.name}">+</button>
            </div>
          </div>
        `;
        return row;
      })
    );
  }

  const total = cartTotal();
  els.subtotal.textContent = money.format(total);
  els.grandTotal.textContent = money.format(total);
  els.sendOrderButton.disabled = entries.length === 0;
}

function sendOrder() {
  const entries = cartEntries();
  if (!entries.length) return;
  const order = {
    id: `order-${Date.now()}`,
    createdAt: new Date().toISOString(),
    storeId: store.id,
    storeName: store.name,
    recipientEmail: store.ownerEmail || freshCartOwnerEmail,
    status: "Unread",
    readAt: "",
    items: entries.map(({ item, quantity }) => ({
      itemId: item.id,
      name: item.name,
      quantity,
      unitPrice: item.price,
      lineTotal: item.price * quantity,
    })),
    total: cartTotal(),
  };
  state.orders.unshift(order);
  entries.forEach(({ item }) => delete state.cart[item.id]);
  saveState(state);
  renderCart();
  showToast(`Order sent to ${order.recipientEmail}.`);
}

function renderAll() {
  if (!store) {
    document.querySelector("main").innerHTML = `<section class="panel auth-panel"><h2>Store not found</h2><p class="helper-text">This shop page does not exist yet.</p><a class="ghost-link" href="super-admin.html">Go to super admin</a></section>`;
    return;
  }
  document.title = `${store.name} | FreshCart`;
  els.pageName.textContent = store.name;
  els.location.textContent = store.location;
  renderCategories();
  renderProducts();
  renderCart();
}

els.search.addEventListener("input", () => {
  renderCategories();
  renderProducts();
});

els.categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selectedCategory = button.dataset.category;
  renderCategories();
  renderProducts();
});

els.productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  state.cart[button.dataset.add] = (state.cart[button.dataset.add] || 0) + 1;
  saveState(state);
  renderCart();
  showToast("Added to cart.");
});

els.cartItems.addEventListener("click", (event) => {
  const increase = event.target.closest("[data-increase]");
  const decrease = event.target.closest("[data-decrease]");
  if (increase) state.cart[increase.dataset.increase] += 1;
  if (decrease) {
    const id = decrease.dataset.decrease;
    state.cart[id] -= 1;
    if (state.cart[id] <= 0) delete state.cart[id];
  }
  saveState(state);
  renderCart();
});

els.sendOrderButton.addEventListener("click", sendOrder);

renderAll();
