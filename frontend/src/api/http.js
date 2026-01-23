import axios from "axios";
import { tokenStorage } from "./tokenStorage";

// Alineado a tu .env.local: VITE_API_URL=http://localhost:8000/api
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export const apiPublic = axios.create({
  baseURL: BASE_URL,
  timeout: 25000,
});

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 25000,
});

api.interceptors.request.use((config) => {
  const access = tokenStorage.getAccess();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  return config;
});

let refreshingPromise = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;

    // No es 401 o request no reintetable
    if (status !== 401 || !original || original._retry) throw error;

    const refresh = tokenStorage.getRefresh();
    if (!refresh) throw error;

    original._retry = true;

    // Un solo refresh concurrente
    if (!refreshingPromise) {
      refreshingPromise = apiPublic
        .post("/auth/refresh/", { refresh })
        .then((r) => r.data)
        .catch((e) => {
          tokenStorage.clear();
          throw e;
        })
        .finally(() => {
          refreshingPromise = null;
        });
    }

    const data = await refreshingPromise;

    tokenStorage.set(data.access, data.refresh || refresh);

    original.headers = original.headers || {};
    original.headers.Authorization = `Bearer ${data.access}`;

    return api.request(original);
  }
);
