// src/api.js
import axios from "axios";

/* ============== Auth store simple (fuera de React) ============== */
const LS_ACCESS = "sc_access";
const LS_REFRESH = "sc_refresh";
const LS_USER = "sc_user";

const authStore = {
  get access() {
    try { return JSON.parse(localStorage.getItem(LS_ACCESS)); } catch { return null; }
  },
  set access(token) {
    if (!token) localStorage.removeItem(LS_ACCESS);
    else localStorage.setItem(LS_ACCESS, JSON.stringify(token));
  },
  get refresh() {
    try { return JSON.parse(localStorage.getItem(LS_REFRESH)); } catch { return null; }
  },
  set refresh(token) {
    if (!token) localStorage.removeItem(LS_REFRESH);
    else localStorage.setItem(LS_REFRESH, JSON.stringify(token));
  },
};

function readStoredToken(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export function getStoredAuth() {
  return {
    access: readStoredToken(LS_ACCESS),
    refresh: readStoredToken(LS_REFRESH),
  };
}

export const apiDiagnostics = {
  publicEndpoint401s: 0,
  privateRefreshAttempts: 0,
};

/* ============== Base URL unificada ============== */
function stripTrailingSlash(s = "") {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
const API_BASE = (() => {
  const env = import.meta.env;
  const ENV_BASE =
    env.VITE_API_BASE_URL?.trim() ??
    env.VITE_API_URL?.trim() ??
    env.VITE_API_BASE?.trim();
  const DEFAULT_DEV_BASE = "http://127.0.0.1:8000/api";
  const DEFAULT_PROD_BASE = "/api";
  const isLocalhostUrl = (value) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(value);

  if (ENV_BASE) {
    if (!env.DEV && isLocalhostUrl(ENV_BASE)) {
      throw new Error(
        "VITE_API_BASE_URL can't point to localhost when building for production."
      );
    }
    return stripTrailingSlash(ENV_BASE);
  }

  if (env.DEV) {
    return stripTrailingSlash(DEFAULT_DEV_BASE);
  }

  return stripTrailingSlash(DEFAULT_PROD_BASE);
})();

const LOGIN_PATH = "/login";

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const normalized = LOGIN_PATH.startsWith("/") ? LOGIN_PATH : `/${LOGIN_PATH}`;
  if (window.location.pathname !== normalized) {
    window.location.assign(normalized);
  }
}

function forceLogoutAndRedirect() {
  clearAuth();
  redirectToLogin();
}

/* ============== Axios instance ============== */
export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
  timeout: 15000,
  headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
});

function mergeConfig(config, overrides) {
  return { ...(config || {}), ...overrides };
}

const PUBLIC_OVERRIDES = { requiresAuth: false };
const HYBRID_OVERRIDES = { requiresAuth: false, sendAuthIfPresent: true };

export const apiPublic = {
  get(url, config) {
    return api.get(url, mergeConfig(config, PUBLIC_OVERRIDES));
  },
  post(url, data, config) {
    return api.post(url, data, mergeConfig(config, PUBLIC_OVERRIDES));
  },
  put(url, data, config) {
    return api.put(url, data, mergeConfig(config, PUBLIC_OVERRIDES));
  },
  patch(url, data, config) {
    return api.patch(url, data, mergeConfig(config, PUBLIC_OVERRIDES));
  },
  delete(url, config) {
    return api.delete(url, mergeConfig(config, PUBLIC_OVERRIDES));
  },
};

export const apiHybrid = {
  get(url, config) {
    return api.get(url, mergeConfig(config, HYBRID_OVERRIDES));
  },
  post(url, data, config) {
    return api.post(url, data, mergeConfig(config, HYBRID_OVERRIDES));
  },
  put(url, data, config) {
    return api.put(url, data, mergeConfig(config, HYBRID_OVERRIDES));
  },
  patch(url, data, config) {
    return api.patch(url, data, mergeConfig(config, HYBRID_OVERRIDES));
  },
  delete(url, config) {
    return api.delete(url, mergeConfig(config, HYBRID_OVERRIDES));
  },
};

/* ============== Helpers de autenticación pública ============== */
const ABSOLUTE_URL = /^https?:\/\//i;

const API_BASE_PATH = (() => {
  const relative = API_BASE.replace(/^https?:\/\/[^/]+/, "");
  return stripTrailingSlash(relative);
})();

function normalizeRequestPath(config) {
  if (!config) return "";
  const rawUrl = (config.url || "").split("?")[0];
  if (!rawUrl) return "";
  let path = rawUrl;
  if (ABSOLUTE_URL.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "";
    }
  } else if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const basePath = API_BASE_PATH || "";
  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length);
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }
  }
  if (!path) return "";
  if (path === "/") return "/";
  return path.replace(/\/+$/, "");
}

function ensureRequiresAuth(config) {
  if (!config) return true;
  if (typeof config.requiresAuth === "boolean") return config.requiresAuth;
  config.requiresAuth = true;
  return true;
}

function requiresAuthentication(config) {
  if (!config) return true;
  return config.requiresAuth !== false;
}

function ensureSendAuthIfPresent(config) {
  if (!config) return false;
  if (typeof config.sendAuthIfPresent === "boolean") return config.sendAuthIfPresent;
  config.sendAuthIfPresent = false;
  return false;
}

function normalizeApiPath(path) {
  if (!path) return path;
  if (ABSOLUTE_URL.test(path)) return path;
  const [base, query] = path.split("?");
  if (!base || base === "/") return path;
  if (base.endsWith("/")) return path;
  const normalized = `${base}/${query ? `?${query}` : ""}`;
  return normalized;
}

const STATIC_FILE_EXT = /\.(?:png|jpe?g|gif|webp|svg|css|js|json|txt|xml|map|ico|woff2?|ttf)$/i;

function ensureTrailingSlashForUrl(url) {
  if (!url) return url;
  if (ABSOLUTE_URL.test(url)) return url;
  const queryIndex = url.indexOf("?");
  const base = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : url.slice(queryIndex);
  if (!base.startsWith("/")) return url;
  if (base.endsWith("/")) return url;
  const lastSegment = base.split("/").pop() || "";
  if (STATIC_FILE_EXT.test(lastSegment)) return url;
  return `${base}/${query}`;
}

/**
 * Detecta si el request original apunta a un endpoint público tal como lo define
 * `PublicEndpointMixin` / `OptionalAuthenticationMixin` en backend/common/endpoint_security.md.
 */
function shouldForceLogout(err) {
  const status = err?.response?.status;
  const config = err?.config;
  return (
    status &&
    (status === 401 || status === 403) &&
    config &&
    requiresAuthentication(config)
  );
}

/* ============== Request interceptor: auth + avisos dev ============== */
api.interceptors.request.use((config) => {
  ensureRequiresAuth(config);
  ensureSendAuthIfPresent(config);
  const normalizedUrl = normalizeApiPath(config.url || "");
  if (normalizedUrl !== config.url) {
    config.url = normalizedUrl;
  }
  const withSlash = ensureTrailingSlashForUrl(config.url || "");
  if (withSlash && withSlash !== config.url) {
    config.url = withSlash;
  }
  // Token
  const token = requiresAuthentication(config) || config.sendAuthIfPresent ? getStoredAuth().access : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Avisos de DX
  if (import.meta.env.DEV) {
    const full = `${config.baseURL || ""}${config.url || ""}`;
    if (full.includes("/api/api/")) {
      // eslint-disable-next-line no-console
      console.warn("[API] Detectado doble /api/ en:", full);
    }
    if (ABSOLUTE_URL.test(config.url || "")) {
      console.warn("[API] Evitá URL absolutas en llamadas:", config.url);
    }
  }

  return config;
});

/* ============== Response interceptor: refresh 401 con cola ============== */
let isRefreshing = false;
let queue = [];
let onErrorGlobal = null;

function flushQueue(error, token = null) {
  queue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(token)));
  queue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (!original || original._retry) throw err;
    const status = err?.response?.status;
    const requiresAuth = requiresAuthentication(original);
    const { refresh: storedRefresh } = getStoredAuth();

    // Solo reintentar en 401 si tenemos refresh token y el request era privado
    if (status === 401 && storedRefresh && requiresAuth) {
      original._retry = true;
      apiDiagnostics.privateRefreshAttempts += 1;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({
            resolve: (newToken) => {
              if (newToken) original.headers.Authorization = `Bearer ${newToken}`;
              resolve(api(original));
            },
            reject,
          });
        });
      }

      isRefreshing = true;
      try {
        // Usamos el MISMO cliente para respetar baseURL y headers
        const { data } = await api.post(
          "/auth/refresh",
          { refresh: storedRefresh },
          { requiresAuth: false }
        );
        const newAccess = data?.access;
        if (!newAccess) throw err;

        authStore.access = newAccess;
        flushQueue(null, newAccess);

        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      } catch (e) {
        flushQueue(e, null);
        forceLogoutAndRedirect();
        throw e;
      } finally {
        isRefreshing = false;
      }
    }

    if (shouldForceLogout(err)) {
      forceLogoutAndRedirect();
    }

    if (status === 401 && !requiresAuth) {
      apiDiagnostics.publicEndpoint401s += 1;
    }

    // Notificación global de error (si hay handler registrado)
    if (onErrorGlobal) {
      try {
        onErrorGlobal(err);
      } catch {
        /* noop */
      }
    }

    throw err;
  }
);

/* ============== Helpers públicos ============== */
export function setAuth({ access, refresh, user } = {}) {
  if (access) authStore.access = access;
  if (refresh) authStore.refresh = refresh;
  if (user) localStorage.setItem(LS_USER, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(LS_ACCESS);
  localStorage.removeItem(LS_REFRESH);
  localStorage.removeItem(LS_USER);
}

/**
 * Registra un callback global para errores de API (para mostrar toasts).
 * @param {(error: any) => void} fn
 */
export function setApiErrorHandler(fn) {
  onErrorGlobal = fn;
}

export function getAuthUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER)); } catch { return null; }
}

export { API_BASE };
