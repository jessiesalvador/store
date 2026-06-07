/**
 * super-admin.js — super admin dashboard, wired to the FreshCart API.
 * Depends on: api.js (loaded before this script in super-admin.html)
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let allStores   = [];
let allAdmins   = [];
let allRequests = [];
let selectedStoreId = null;   // for the "assign admin" dropdown
const resetToken = new URLSearchParams(window.location.search).get("resetToken");

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
  loadingPanel:    document.querySelector("#super-loading-panel"),
  loginPanel:      document.querySelector("#super-login-panel"),
  content:         document.querySelector("#super-content"),
  loginForm:       document.querySelector("#super-login-form"),
  logoutButton:    document.querySelector("#super-logout-button"),
  forgotPasswordButton: document.querySelector("#super-forgot-password-button"),
  forgotPasswordModal: document.querySelector("#forgot-password-modal"),
  forgotPasswordForm: document.querySelector("#forgot-password-form"),
  forgotPasswordEmail: document.querySelector("#forgot-password-email"),
  forgotPasswordMessage: document.querySelector("#forgot-password-message"),
  forgotPasswordCancel: document.querySelector("#forgot-password-cancel"),
  resetPasswordModal: document.querySelector("#reset-password-modal"),
  resetPasswordForm: document.querySelector("#reset-password-form"),
  resetNewPassword: document.querySelector("#reset-new-password"),
  resetPasswordMessage: document.querySelector("#reset-password-message"),
  adminStoreSelect:document.querySelector("#admin-store-select"),
  approvalResult:  document.querySelector("#approval-result"),
  requestsList:    document.querySelector("#requests-list"),
  requestCount:    document.querySelector("#request-count"),
  storeList:       document.querySelector("#store-list"),
  storeCount:      document.querySelector("#store-count"),
  adminList:       document.querySelector("#admin-list"),
  adminCount:      document.querySelector("#admin-count"),
  toast:           document.querySelector("#toast"),
};

// ── Toast ─────────────────────────────────────────────────────────────────────
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

function option(value, label) {
  const el = document.createElement("option");
  el.value = value; el.textContent = label;
  return el;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderSuperAdmin() {
  // Store dropdown for admin assignment
  els.adminStoreSelect.replaceChildren(
    ...allStores.map((s) => option(s._id, `${s.name} - ${s.location}`))
  );
  if (!allStores.find((s) => s._id === selectedStoreId)) {
    selectedStoreId = allStores[0]?._id || null;
  }
  if (selectedStoreId) els.adminStoreSelect.value = selectedStoreId;

  // Counts
  els.requestCount.textContent = `${allRequests.filter((r) => r.status === "pending").length} pending`;
  els.storeCount.textContent   = `${allStores.length} ${allStores.length === 1 ? "store" : "stores"}`;
  els.adminCount.textContent   = `${allAdmins.length} admins`;

  // Requests
  const pending = allRequests.filter((r) => r.status === "pending");
  if (!pending.length) {
    els.requestsList.innerHTML = `<div class="empty-state">No pending owner requests.</div>`;
  } else {
    els.requestsList.replaceChildren(...pending.map((req) => {
      const row = document.createElement("div");
      row.className = "request-row";
      row.innerHTML = `
        <div>
          <p><strong>${h(req.storeName)}</strong></p>
          <small>Requested by ${h(req.ownerName)} (${h(req.ownerEmail)})</small>
        </div>
        <button type="button" data-approve="${req._id}">Approve</button>`;
      return row;
    }));
  }

  // Stores
  if (!allStores.length) {
    els.storeList.innerHTML = `<div class="empty-state">No stores yet.</div>`;
  } else {
    els.storeList.replaceChildren(...allStores.map((store) => {
      const row = document.createElement("div");
      row.className = "store-row";
      row.innerHTML = `
        <div>
          <p><strong>${h(store.name)}</strong></p>
          <small>${h(store.location)}</small>
          <label class="slug-control">
            Store URL
            <span>store.html?id=</span>
            <input data-store-slug="${store._id}" value="${h(store.slug)}" aria-label="Store URL slug for ${h(store.name)}">
          </label>
        </div>
        <div class="store-actions">
          <a class="ghost-link" href="store.html?id=${encodeURIComponent(store.slug)}">Open shop page</a>
          <button class="ghost-button" type="button" data-save-store-url="${store._id}">Rename URL</button>
          <button class="danger-button" type="button" data-delete-store="${store._id}">Delete store</button>
          <span class="tag">${store.categories.length} categories</span>
        </div>`;
      return row;
    }));
  }

  // Admins
  if (!allAdmins.length) {
    els.adminList.innerHTML = `<div class="empty-state">No store admins yet.</div>`;
  } else {
    els.adminList.replaceChildren(...allAdmins.map((admin) => {
      const store = allStores.find((s) => s._id === admin.storeId?._id || s._id === admin.storeId);
      const row   = document.createElement("div");
      row.className = "person-row";
      row.innerHTML = `
        <div>
          <p><strong>${h(admin.name)}</strong></p>
          <small>${h(admin.email)}</small>
        </div>
        <div class="store-actions">
          <span class="tag">${store ? h(store.name) : "Unassigned"}</span>
          <button class="danger-button" type="button" data-delete-admin="${admin._id}">Delete admin</button>
        </div>`;
      return row;
    }));
  }
}

// ── Load all data and re-render ───────────────────────────────────────────────
async function loadAndRender() {
  const [storesData, adminsData, requestsData] = await Promise.all([
    api.get("/stores"),
    api.get("/admins"),
    api.get("/store-requests"),
  ]);
  allStores   = storesData.stores;
  allAdmins   = adminsData.admins;
  allRequests = requestsData.requests;
  renderSuperAdmin();
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function unlockSuperAdmin() {
  els.loadingPanel.classList.add("hidden");
  els.loginPanel.classList.add("hidden");
  els.content.classList.remove("hidden");
  els.logoutButton.classList.remove("hidden");
  await loadAndRender();
}

async function logoutSuperAdmin() {
  try {
    await api.post("/auth/logout", {});
  } catch {
    // The session may already be gone; still reset the local UI.
  }
  currentUser = null;
  allStores = [];
  allAdmins = [];
  allRequests = [];
  selectedStoreId = null;
  els.loadingPanel.classList.add("hidden");
  els.content.classList.add("hidden");
  els.loginPanel.classList.remove("hidden");
  els.logoutButton.classList.add("hidden");
  els.loginForm.reset();
  showToast("Logged out.");
}

els.logoutButton.addEventListener("click", logoutSuperAdmin);

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
    const data = await api.resetPassword(resetToken, newPassword);
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
  const password = form.get("password");
  try {
    const data = await api.login(form.get("email").trim().toLowerCase(), password);
    if (data.user.role !== "super-admin") {
      showToast("This login is for the super admin only.");
      await api.post("/auth/logout", {});
      return;
    }
    currentUser = data.user;
    await unlockSuperAdmin();
  } catch (err) {
    showToast(err.message || "Invalid email or password.");
  } finally {
    event.currentTarget.elements.password.value = "";
  }
});

// ── Store dropdown change ─────────────────────────────────────────────────────
els.adminStoreSelect.addEventListener("change", () => {
  selectedStoreId = els.adminStoreSelect.value;
});

// ── Add store ─────────────────────────────────────────────────────────────────
document.querySelector("#store-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const form = new FormData(formEl);
  const name = form.get("storeName").trim();
  const location = form.get("location").trim();
  if (!name || !location) { showToast("Store name and location are required."); return; }
  try {
    await api.post("/stores", { name, location, ownerEmail: "pending@freshcart.app" });
    formEl.reset();
    await loadAndRender();
    showToast("Store added.");
  } catch (err) {
    showToast(err.message || "Failed to add store.");
  }
});

// ── Add admin ─────────────────────────────────────────────────────────────────
document.querySelector("#admin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const form  = new FormData(formEl);
  const name  = form.get("adminName").trim();
  const email = form.get("email").trim().toLowerCase();
  if (!name || !email || !selectedStoreId) {
    showToast("Name, email and a selected store are required.");
    return;
  }
  try {
    const data = await api.post("/admins", { name, email, storeId: selectedStoreId });
    formEl.reset();
    await loadAndRender();
    // Show credentials in the approval result box
    const store = allStores.find((s) => s._id === selectedStoreId);
    els.approvalResult.classList.remove("hidden");
    els.approvalResult.innerHTML = `
      <div><p><strong>Admin email</strong></p><p>${h(email)}</p></div>
      <div><p><strong>Status</strong></p><p>${h(data.message)}</p></div>
      <a class="ghost-link" href="store.html?id=${encodeURIComponent(store?.slug || selectedStoreId)}">Open shop page</a>`;
    showToast(data.emailSent === false ? "Admin created, but email was not sent." : "Admin access granted. Temporary password emailed.");
  } catch (err) {
    showToast(err.message || "Failed to create admin.");
  }
});

// ── Store list actions ────────────────────────────────────────────────────────
els.storeList.addEventListener("click", async (event) => {
  const saveBtn   = event.target.closest("[data-save-store-url]");
  const deleteBtn = event.target.closest("[data-delete-store]");

  if (saveBtn) {
    const storeId = saveBtn.dataset.saveStoreUrl;
    const input   = els.storeList.querySelector(`[data-store-slug="${storeId}"]`);
    const newSlug = input.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!newSlug) { showToast("Enter a valid store URL."); return; }
    try {
      await api.patch(`/stores/${storeId}`, { slug: newSlug });
      await loadAndRender();
      showToast("Store URL updated.");
    } catch (err) {
      showToast(err.message || "Failed to rename store URL.");
    }
  }

  if (deleteBtn) {
    const storeId = deleteBtn.dataset.deleteStore;
    if (!confirm("Delete this store and all its items and orders? This cannot be undone.")) return;
    try {
      await api.delete(`/stores/${storeId}`);
      await loadAndRender();
      showToast("Store deleted.");
    } catch (err) {
      showToast(err.message || "Failed to delete store.");
    }
  }
});

// ── Admin list: delete ────────────────────────────────────────────────────────
els.adminList.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-delete-admin]");
  if (!btn) return;
  try {
    await api.delete(`/admins/${btn.dataset.deleteAdmin}`);
    await loadAndRender();
    showToast("Admin deleted.");
  } catch (err) {
    showToast(err.message || "Failed to delete admin.");
  }
});

// ── Requests: approve ─────────────────────────────────────────────────────────
els.requestsList.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-approve]");
  if (!btn) return;
  const location = prompt("Enter the store location (e.g. Brisbane CBD):");
  if (!location) return;
  try {
    const data = await api.post(`/store-requests/${btn.dataset.approve}/approve`, { location });
    await loadAndRender();
    els.approvalResult.classList.remove("hidden");
    els.approvalResult.innerHTML = `
      <div><p><strong>Store approved</strong></p><p>${h(data.store.name)} - ${h(data.store.location)}</p></div>
      <div><p><strong>Status</strong></p><p>Credentials emailed to the store owner.</p></div>
      <a class="ghost-link" href="store.html?id=${encodeURIComponent(data.store.slug)}">Open shop page</a>`;
    showToast("Store approved. Credentials emailed.");
  } catch (err) {
    showToast(err.message || "Failed to approve request.");
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
    if (data.user.role === "super-admin") {
      currentUser = data.user;
      await unlockSuperAdmin();
    } else {
      els.loadingPanel.classList.add("hidden");
      els.loginPanel.classList.remove("hidden");
    }
  } catch {
    els.loadingPanel.classList.add("hidden");
    els.loginPanel.classList.remove("hidden");
  }
}

boot();
