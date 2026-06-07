/**
 * api.js — shared fetch wrapper for the FreshCart backend.
 * All three pages (store, admin, super-admin) include this script.
 */

const API = (() => {
  if (window.FRESHCART_API_BASE) return window.FRESHCART_API_BASE;
  if (location.protocol === "file:") return "http://localhost:3000/api";
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port && location.port !== "3000") {
    return "http://localhost:3000/api";
  }
  return `${location.origin}/api`;
})();

let csrfTokenPromise = null;

function base64UrlFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch(`${API}/auth/csrf`, { credentials: "include" })
      .then(parseJson)
      .then((data) => data.csrfToken)
      .catch((err) => {
        csrfTokenPromise = null;
        throw err;
      });
  }
  return csrfTokenPromise;
}

async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    headers["x-csrf-token"] = await getCsrfToken();
  }

  const res = await fetch(`${API}${path}`, {
    credentials: "include",          // send session cookie on every request
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: res.status });
  if (data.csrfToken) csrfTokenPromise = Promise.resolve(data.csrfToken);
  if (path === "/auth/logout") csrfTokenPromise = null;
  return data;
}

async function encryptPasswordPayload(secretPayload) {
  if (!window.crypto?.subtle) {
    throw new Error("Secure password encryption is not available in this browser.");
  }

  const keyData = await apiFetch("/auth/login-key");
  const rsaKey = await window.crypto.subtle.importKey(
    "jwk",
    keyData.publicKey,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const aesKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encodedPayload = new TextEncoder().encode(JSON.stringify(secretPayload));
  const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encodedPayload);
  const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
  const keyCiphertext = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, rawAesKey);

  return {
    loginKeyId: keyData.keyId,
    passwordPayload: {
      keyCiphertext: base64UrlFromBuffer(keyCiphertext),
      iv: base64UrlFromBuffer(iv),
      ciphertext: base64UrlFromBuffer(ciphertext),
    },
  };
}

async function postWithEncryptedPassword(path, publicBody, secretPayload) {
  const encrypted = await encryptPasswordPayload(secretPayload);
  return apiFetch(path, {
    method: "POST",
    body: JSON.stringify({ ...publicBody, ...encrypted }),
  });
}

// Convenience wrappers
const api = {
  get:    (path)         => apiFetch(path),
  post:   (path, body)   => apiFetch(path, { method: "POST",   body: JSON.stringify(body) }),
  patch:  (path, body)   => apiFetch(path, { method: "PATCH",  body: JSON.stringify(body) }),
  delete: (path)         => apiFetch(path, { method: "DELETE" }),
  login:  (email, password) =>
    postWithEncryptedPassword("/auth/login", { email }, { password }),
  resetPassword: (token, newPassword) =>
    postWithEncryptedPassword("/auth/reset-password", { token }, { newPassword }),
  changePassword: ({ currentPassword, newPassword }) =>
    postWithEncryptedPassword(
      "/auth/change-password",
      {},
      currentPassword ? { currentPassword, newPassword } : { newPassword }
    ),
  // For FormData (file uploads)
  postForm: (path, formData) =>
    getCsrfToken()
      .then((token) => fetch(`${API}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": token },
        body: formData,
      }).then(parseJson)),
  patchForm: (path, formData) =>
    getCsrfToken()
      .then((token) => fetch(`${API}${path}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "x-csrf-token": token },
        body: formData,
      }).then(parseJson)),
};

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: res.status });
  return data;
}
