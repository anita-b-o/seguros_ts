// src/services/adminUsersApi.js
import { api } from "@/api/http";

export const adminUsersApi = {
  list: async ({ page = 1, page_size = 10, q = "" } = {}) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(page_size));

    // DRF SearchFilter suele usar "search"
    if (q && String(q).trim()) params.set("search", String(q).trim());

    const url = `/admin/accounts/users/?${params.toString()}`; // ✅ OJO: api ya suele tener baseURL "/api"
    const { data } = await api.get(url);
    return data;
  },

  get: async (id) => {
    const { data } = await api.get(`/admin/accounts/users/${id}/`);
    return data;
  },

  listPolicies: async (userId) => {
    const { data } = await api.get(`/admin/accounts/users/${userId}/policies/`);
    return data;
  },

  attachPolicy: async (userId, policyId) => {
    const { data } = await api.post(`/admin/accounts/users/${userId}/policies/`, {
      policy_id: policyId,
    });
    return data;
  },

  detachPolicy: async (userId, policyId) => {
    const { data } = await api.delete(
      `/admin/accounts/users/${userId}/policies/${policyId}/`
    );
    return data;
  },
};
