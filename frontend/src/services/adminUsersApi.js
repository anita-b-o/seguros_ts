// src/services/adminUsersApi.js
import { api } from "@/api/http";

export const adminUsersApi = {
  list: async ({ page = 1, page_size = 10, q = "" } = {}) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(page_size));

    // Solo clientes (si tu backend no filtra por is_staff, simplemente lo ignorará)
    params.set("is_staff", "false");

    // Búsqueda (si tu backend no soporta q, lo ignorará)
    if (q) params.set("q", q);

    const { data } = await api.get(`/admin/accounts/users?${params.toString()}`);
    return data;
  },

  get: async (id) => {
    const { data } = await api.get(`/admin/accounts/users/${id}`);
    return data;
  },

  // --- UserPolicies ---
  listPolicies: async (userId) => {
    const { data } = await api.get(`/admin/accounts/users/${userId}/policies`);
    return data;
  },

  attachPolicy: async (userId, policyId) => {
    const { data } = await api.post(`/admin/accounts/users/${userId}/policies`, {
      policy_id: policyId,
    });
    return data;
  },

  detachPolicy: async (userId, policyId) => {
    // backend devuelve 204, axios igual resuelve (data suele ser undefined)
    const { data } = await api.delete(`/admin/accounts/users/${userId}/policies/${policyId}`);
    return data;
  },
};
