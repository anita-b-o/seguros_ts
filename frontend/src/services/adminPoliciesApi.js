// frontend/src/services/adminPoliciesApi.js
import { api } from "@/api/http";

const BASE = "/admin/policies/policies"; // sin slash final
const detail = (id) => `${BASE}/${id}`;

export const adminPoliciesApi = {
  async list({ page = 1, search = "", only_unassigned = false, in_adjustment = false } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (search) params.set("search", String(search).trim());
    if (only_unassigned) params.set("only_unassigned", "true");
    if (in_adjustment) params.set("in_adjustment", "true");

    const url = params.toString() ? `${BASE}/?${params.toString()}` : `${BASE}/`;
    const { data } = await api.get(url);
    return data;
  },

  async listDeleted({ page = 1, page_size = 5 } = {}) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(page_size));

    const { data } = await api.get(`${BASE}/deleted/?${params.toString()}`);
    return data;
  },

  async get(id) {
    const { data } = await api.get(`${detail(id)}/`);
    return data;
  },

  async create(payload) {
    const { data } = await api.post(`${BASE}/`, payload);
    return data;
  },

  async patch(id, payload) {
    const { data } = await api.patch(`${detail(id)}/`, payload);
    return data;
  },

  async remove(id) {
    await api.delete(`${detail(id)}/`);
    return true;
  },

  async restore(id) {
    const { data } = await api.post(`${detail(id)}/restore/`);
    return data;
  },

  // ✅ NUEVO: marcar como abonada (pago manual/admin)
  async markPaid(id) {
    const { data } = await api.post(`${detail(id)}/mark-paid/`);
    return data;
  },

  async listInsuranceTypes({ page = 1 } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));

    const base = "/admin/products/insurance-types";
    const url = params.toString() ? `${base}/?${params.toString()}` : `${base}/`;

    const { data } = await api.get(url);
    return data;
  },

  async adjustmentCount() {
    const { data } = await api.get(`${BASE}/adjustment-count/`);
    return data; // { count: number }
  },

  async stats() {
    const { data } = await api.get(`${BASE}/stats/`);
    return data;
  },

  async listByStatus({ status, page = 1 } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (status) params.set("status", String(status));
    const url = `${BASE}/?${params.toString()}`;
    const { data } = await api.get(url);
    return data;
  },

};
