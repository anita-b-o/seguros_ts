// frontend/src/services/adminPoliciesApi.js
import { api } from "@/api/http";

const BASE = "/admin/policies/policies"; // SIN slash final
const detail = (id) => `${BASE}/${id}`;

// helper: arma URL SIN meter "/" antes del "?"
function withQuery(base, params) {
  const qs = params?.toString?.() ? params.toString() : "";
  return qs ? `${base}?${qs}` : `${base}`;
}

export const adminPoliciesApi = {
  async list({
    page = 1,
    page_size, // opcional
    search = "",
    only_unassigned = false,
    in_adjustment = false,
    status, // opcional
  } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (page_size) params.set("page_size", String(page_size));
    if (search) params.set("search", String(search).trim());
    if (only_unassigned) params.set("only_unassigned", "true");
    if (in_adjustment) params.set("in_adjustment", "true");
    if (status) params.set("status", String(status));

    const url = withQuery(BASE, params); // ✅ /admin/policies/policies?page=...
    const { data } = await api.get(url);
    return data;
  },

  async listDeleted({ page = 1, page_size = 5 } = {}) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(page_size));

    // backend alias: /policies/deleted (y suele aceptar también /deleted/)
    const url = withQuery(`${BASE}/deleted`, params); // ✅ /deleted?page=...
    const { data } = await api.get(url);
    return data;
  },

  async get(id) {
    if (!id) throw new Error("id requerido");
    // canónico sin slash final
    const { data } = await api.get(detail(id));
    return data;
  },

  async create(payload) {
    // canónico sin slash final
    const { data } = await api.post(BASE, payload);
    return data;
  },

  async patch(id, payload) {
    if (!id) throw new Error("id requerido");
    // canónico sin slash final
    const { data } = await api.patch(detail(id), payload);
    return data;
  },

  async remove(id) {
    if (!id) throw new Error("id requerido");
    // canónico sin slash final
    await api.delete(detail(id));
    return true;
  },

  async restore(id) {
    if (!id) throw new Error("id requerido");
    // action
    const { data } = await api.post(`${detail(id)}/restore`);
    return data;
  },

  // ✅ marcar como abonada (pago manual/admin)
  async markPaid(id) {
    if (!id) throw new Error("id requerido");
    const { data } = await api.post(`${detail(id)}/mark-paid`);
    return data;
  },

  async listInsuranceTypes({ page = 1, page_size } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (page_size) params.set("page_size", String(page_size));

    const base = "/admin/products/insurance-types"; // SIN slash final
    const url = withQuery(base, params); // ✅ /insurance-types?page=...
    const { data } = await api.get(url);
    return data;
  },

  async adjustmentCount() {
    const { data } = await api.get(`${BASE}/adjustment-count`);
    return data; // { count: number }
  },

  async stats() {
    const { data } = await api.get(`${BASE}/stats`);
    return data;
  },

  async listByStatus({ status, page = 1, page_size = 10 } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (page_size) params.set("page_size", String(page_size));
    if (status) params.set("status", String(status));

    const url = withQuery(BASE, params); // ✅ /policies?status=...&page=...
    const { data } = await api.get(url);
    return data;
  },
};
