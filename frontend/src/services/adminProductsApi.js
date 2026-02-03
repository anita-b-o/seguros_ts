// src/services/adminProductsApi.js
import { api } from "@/api/http";

export const adminProductsApi = {
  list: async ({ page = 1, page_size = 10, q = "" } = {}) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(page_size));
    if (q) params.set("q", q);

    // admin: products -> insurance-types
    const { data } = await api.get(`/admin/products/insurance-types/?${params.toString()}`);
    return data;
  },

  listDeleted: async ({ page = 1, page_size = 5, q = "" } = {}) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(page_size));
    if (q) params.set("q", q);
    const { data } = await api.get(
      `/admin/products/insurance-types/deleted/?${params.toString()}`
    );
    return data;
  },

  get: async (id) => {
    const { data } = await api.get(`/admin/products/insurance-types/${id}/`);
    return data;
  },

  create: async (payload) => {
    const { data } = await api.post(`/admin/products/insurance-types/`, payload);
    return data;
  },

  patch: async (id, payload) => {
    const { data } = await api.patch(`/admin/products/insurance-types/${id}/`, payload);
    return data;
  },

  remove: async (id) => {
    const { data } = await api.delete(`/admin/products/insurance-types/${id}/`);
    return data;
  },

  restore: async (id) => {
    const { data } = await api.post(`/admin/products/insurance-types/${id}/restore/`);
    return data;
  },
};
