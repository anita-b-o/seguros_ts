// frontend/src/api/http.js
import axios from "axios";
// Alineado a tu .env.local:
// VITE_API_URL=http://localhost:8000/api
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

/**
 * Cliente público (sin auth)
 */
export const apiPublic = axios.create({
  baseURL: BASE_URL,
  timeout: 25000,
  withCredentials: true,
});

/**
 * Cliente autenticado (Bearer)
 */
export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 25000,
  withCredentials: true,
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

    original._retry = true;

    // 🔁 Un solo refresh concurrente
    if (!refreshingPromise) {
      refreshingPromise = apiPublic
        .post("/auth/refresh", {})
        .then((res) => res.data)
        .finally(() => {
          refreshingPromise = null;
        });
    }

    await refreshingPromise;

    return api.request(original);
  }
);
