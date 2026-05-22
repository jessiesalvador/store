const state = loadState();

const els = {
  loginPanel: document.querySelector("#super-login-panel"),
  content: document.querySelector("#super-content"),
  loginForm: document.querySelector("#super-login-form"),
  adminStoreSelect: document.querySelector("#admin-store-select"),
  approvalResult: document.querySelector("#approval-result"),
  requestsList: document.querySelector("#requests-list"),
  requestCount: document.querySelector("#request-count"),
  storeList: document.querySelector("#store-list"),
  storeCount: document.querySelector("#store-count"),
  adminList: document.querySelector("#admin-list"),
  adminCount: document.querySelector("#admin-count"),
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

function showApprovalResult(email, password, storeId) {
  els.approvalResult.classList.remove("hidden");
  els.approvalResult.innerHTML = `
    <div>
      <p><strong>Admin email</strong></p>
      <p>${email}</p>
    </div>
    <div>
      <p><strong>Temporary password</strong></p>
      <p>${password}</p>
    </div>
    <a class="ghost-link" href="${storePageUrl(storeId)}">Open new shop page</a>
  `;
}

function renderSuperAdmin() {
  els.adminStoreSelect.replaceChildren(
    ...state.stores.map((store) => option(store.id, `${store.name} - ${store.location}`))
  );
  if (!getStore(state, state.selectedAdminAssignment)) {
    state.selectedAdminAssignment = state.stores[0]?.id;
  }
  els.adminStoreSelect.value = state.selectedAdminAssignment;
  els.requestCount.textContent = `${state.requests.length} pending`;
  els.storeCount.textContent = `${state.stores.length} ${state.stores.length === 1 ? "store" : "stores"}`;
  els.adminCount.textContent = `${state.admins.length} admins`;

  if (!state.requests.length) {
    els.requestsList.innerHTML = `<div class="empty-state">No pending owner requests.</div>`;
  } else {
    els.requestsList.replaceChildren(
      ...state.requests.map((request) => {
        const row = document.createElement("div");
        row.className = "request-row";
        row.innerHTML = `
          <div>
            <p><strong>${request.storeName}</strong></p>
            <small>Requested by ${request.ownerName}</small>
          </div>
          <button type="button" data-approve="${request.id}">Approve</button>
        `;
        return row;
      })
    );
  }

  els.storeList.replaceChildren(
    ...state.stores.map((store) => {
      const row = document.createElement("div");
      row.className = "store-row";
      row.innerHTML = `
        <div>
          <p><strong>${store.name}</strong></p>
          <small>${store.location}</small>
          <label class="slug-control">
            Store URL
            <span>store.html?store=</span>
            <input data-store-slug="${store.id}" value="${store.id}" aria-label="Store URL slug for ${store.name}">
          </label>
        </div>
        <div class="store-actions">
          <a class="ghost-link" href="${storePageUrl(store.id)}">Open shop page</a>
          <button class="ghost-button" type="button" data-save-store-url="${store.id}">Rename URL</button>
          <button class="danger-button" type="button" data-delete-store="${store.id}">Delete store</button>
          <span class="tag">${store.categories.length} categories</span>
        </div>
      `;
      return row;
    })
  );

  els.adminList.replaceChildren(
    ...state.admins.map((admin) => {
      const store = getStore(state, admin.storeId);
      const row = document.createElement("div");
      row.className = "person-row";
      row.innerHTML = `
        <div>
          <p><strong>${admin.name}</strong></p>
          <small>${admin.email}</small>
        </div>
        <div class="store-actions">
          <span class="tag">${store ? store.name : "Unassigned"}</span>
          <button class="danger-button" type="button" data-delete-admin="${admin.email}">Delete admin</button>
        </div>
      `;
      return row;
    })
  );
  saveState(state);
}

function unlockSuperAdmin() {
  els.loginPanel.classList.add("hidden");
  els.content.classList.remove("hidden");
  renderSuperAdmin();
}

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (checkLogin("super", form.get("email"), form.get("password"))) {
    sessionStorage.setItem("freshcart-super-admin", "true");
    unlockSuperAdmin();
  } else {
    showToast("Invalid super admin email or password.");
  }
});

els.adminStoreSelect.addEventListener("change", () => {
  state.selectedAdminAssignment = els.adminStoreSelect.value;
  saveState(state);
});

document.querySelector("#store-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = form.get("storeName").trim();
  const storeId = `${slugify(name)}-${Date.now()}`;
  state.stores.push({
    id: storeId,
    name,
    location: form.get("location").trim(),
    ownerEmail: "",
    categories: ["Sample category"],
  });
  state.items.push(sampleItemForStore(storeId, name));
  state.selectedAdminAssignment = storeId;
  event.currentTarget.reset();
  renderSuperAdmin();
  showToast("Store added with a sample shop page.");
});

document.querySelector("#admin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const store = getStore(state, state.selectedAdminAssignment);
  const email = form.get("email").trim().toLowerCase();
  const password = generateTemporaryPassword();
  state.admins.push({
    name: form.get("adminName").trim(),
    email,
    password,
    storeId: state.selectedAdminAssignment,
  });
  if (store) store.ownerEmail = email;
  event.currentTarget.reset();
  renderSuperAdmin();
  showApprovalResult(email, password, state.selectedAdminAssignment);
  showToast("Admin access granted.");
});

els.storeList.addEventListener("click", (event) => {
  const saveButton = event.target.closest("[data-save-store-url]");
  const deleteButton = event.target.closest("[data-delete-store]");

  if (saveButton) {
    const oldId = saveButton.dataset.saveStoreUrl;
    const input = els.storeList.querySelector(`[data-store-slug="${oldId}"]`);
    const nextId = slugify(input.value);
    if (!nextId) {
      showToast("Enter a valid store URL.");
      return;
    }
    if (!changeStoreId(state, oldId, nextId)) {
      showToast("That store URL is already used.");
      return;
    }
    saveState(state);
    renderSuperAdmin();
    showToast("Store URL renamed.");
  }

  if (deleteButton) {
    const storeId = deleteButton.dataset.deleteStore;
    deleteStore(state, storeId);
    saveState(state);
    renderSuperAdmin();
    showToast("Store deleted.");
  }
});

els.adminList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-admin]");
  if (!button) return;
  const email = button.dataset.deleteAdmin;
  state.admins = state.admins.filter((admin) => admin.email !== email);
  state.stores.forEach((store) => {
    if (store.ownerEmail === email) store.ownerEmail = "";
  });
  saveState(state);
  renderSuperAdmin();
  showToast("Admin deleted.");
});

els.requestsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-approve]");
  if (!button) return;
  const request = state.requests.find((item) => item.id === button.dataset.approve);
  if (!request) return;
  const storeId = `${slugify(request.storeName)}-${Date.now()}`;
  state.stores.push({
    id: storeId,
    name: request.storeName,
    location: "New branch",
    ownerEmail: "",
    categories: ["Sample category"],
  });
  state.items.push(sampleItemForStore(storeId, request.storeName));
  const adminEmail = `${slugify(request.ownerName)}@example.com`;
  const password = generateTemporaryPassword();
  state.admins.push({
    name: request.ownerName,
    email: adminEmail,
    password,
    storeId,
  });
  const store = getStore(state, storeId);
  if (store) store.ownerEmail = adminEmail;
  state.requests = state.requests.filter((item) => item.id !== request.id);
  state.selectedAdminAssignment = storeId;
  renderSuperAdmin();
  showApprovalResult(adminEmail, password, storeId);
  showToast("Store approved with a sample shop page.");
});

if (sessionStorage.getItem("freshcart-super-admin") === "true") {
  unlockSuperAdmin();
}
