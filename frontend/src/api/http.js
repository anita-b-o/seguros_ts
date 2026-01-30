// frontend/src/api/http.js
import axios from "axios";
import { tokenStorage } from "./tokenStorage";

// Alineado a tu .env.local:
// VITE_API_URL=http://localhost:8000/api
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

/**
 * Cliente público (sin auth)
 */
export const apiPublic = axios.create({
  baseURL: BASE_URL,
  timeout: 25000,
});

/**
 * Cliente autenticado (Bearer)
 */
export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 25000,
});

/* =========================================================
   REQUEST INTERCEPTOR — inyecta Authorization
   ========================================================= */
api.interceptors.request.use((config) => {
  const access = tokenStorage.getAccess();

  config.headers = config.headers || {};
  if (access) {
    config.headers.Authorization = `Bearer ${access}`;
  }

  return config;
});

/* =========================================================
   RESPONSE INTERCEPTOR — refresh token (controlado)
   ========================================================= */
let refreshingPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;

    if (!original) {
      throw error;
    }

    const url = String(original.url || "");

    // 🔒 Endpoints donde NO se debe refrescar
    const isAuthEndpoint =
      url.includes("/auth/login") ||
      url.includes("/auth/logout") ||
      url.includes("/auth/refresh") ||
      url.includes("/auth/register");

    // Si el request lo pidió explícitamente, o es auth, no refrescar
    if (original.skipAuthRefresh || isAuthEndpoint) {
      throw error;
    }

    // Solo intentamos refresh en 401
    if (status !== 401 || original._retry) {
      throw error;
    }

    const refresh = tokenStorage.getRefresh();
    if (!refresh) {
      tokenStorage.clear?.();
      throw error;
    }

    original._retry = true;

    // 🔁 Un solo refresh concurrente
    if (!refreshingPromise) {
      refreshingPromise = apiPublic
        .post("/auth/refresh", { refresh })
        .then((res) => res.data)
        .catch((err) => {
          // Refresh inválido → limpiar sesión
          tokenStorage.clear?.();
          throw err;
        })
        .finally(() => {
          refreshingPromise = null;
        });
    }

    const data = await refreshingPromise;

    if (!data?.access) {
      tokenStorage.clear?.();
      throw error;
    }

    // Guardamos tokens nuevos
    tokenStorage.set(data.access, data.refresh || refresh);

    // Reintentamos request original con nuevo access
    original.headers = original.headers || {};
    original.headers.Authorization = `Bearer ${data.access}`;

    return api.request(original);
  }
);
