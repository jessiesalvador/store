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

// Convenience wrappers
const api = {
  get:    (path)         => apiFetch(path),
  post:   (path, body)   => apiFetch(path, { method: "POST",   body: JSON.stringify(body) }),
  patch:  (path, body)   => apiFetch(path, { method: "PATCH",  body: JSON.stringify(body) }),
  delete: (path)         => apiFetch(path, { method: "DELETE" }),
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
