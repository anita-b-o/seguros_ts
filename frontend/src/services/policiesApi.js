// src/services/policiesApi.js
import { api } from "@/api/http";

/**
 * Policies API (cliente)
 *
 * Backend usa:
 * - APPEND_SLASH=False
 * - DefaultRouter(trailing_slash=False)
 *
 * Por lo tanto, los endpoints del router y @action se consumen SIN slash final.
 */
export const policiesApi = {
  // -----------------------
  // Dashboard
  // -----------------------
  async getMyDashboard({ policyId } = {}) {
    const { data } = await api.get("/policies/my/dashboard", {
      params: policyId ? { policy_id: policyId } : undefined,
    });
    return data;
  },

  // -----------------------
  // Listado simple (cliente)
  // -----------------------
  async listMyPolicies() {
    const { data } = await api.get("/policies/my");
    return data;
  },

  // -----------------------
  // Detalle / Refresh
  // -----------------------
  async getPolicy(policyId) {
    if (!policyId) throw new Error("getPolicy: policyId es requerido");
    const { data } = await api.get(`/policies/${policyId}`);
    return data;
  },

  async refreshPolicy(policyId) {
    if (!policyId) throw new Error("refreshPolicy: policyId es requerido");
    const { data } = await api.post(`/policies/${policyId}/refresh`);
    return data;
  },

  // -----------------------
  // Billing
  // -----------------------
  async getBillingCurrent(policyId) {
    if (!policyId) throw new Error("getBillingCurrent: policyId es requerido");
    const { data } = await api.get(`/policies/${policyId}/billing/current`);
    return data;
  },

  // -----------------------
  // Receipts (Comprobantes)
  // -----------------------
  /**
   * Lista comprobantes de una póliza (paginado).
   *
   * @param {number|string} policyId
   * @param {object} options
   * @param {number} options.page       Página (default 1)
   * @param {number} options.pageSize   Tamaño de página (default 10)
   */
  async listReceipts(policyId, { page = 1, pageSize = 10 } = {}) {
    if (!policyId) throw new Error("listReceipts: policyId es requerido");

    const { data } = await api.get(`/policies/${policyId}/receipts`, {
      params: {
        page,
        page_size: pageSize,
      },
    });

    // data = { count, next, previous, results }
    return data;
  },

  // -----------------------
  // Claim (asociar póliza)
  // -----------------------
  async claimPolicy({ numberOrCode }) {
    const number = (numberOrCode || "").trim();
    if (!number) throw new Error("claimPolicy: numberOrCode es requerido");

    const { data } = await api.post("/policies/claim", { number });
    return data;
  },

  // -----------------------
  // Asociar póliza (self-service)
  // -----------------------
  async associateMyPolicy({ policyNumber }) {
    const policy_number = (policyNumber || "").trim();
    if (!policy_number) throw new Error("associateMyPolicy: policyNumber es requerido");

    const { data } = await api.post("/accounts/users/me/policies/associate", {
      policy_number,
    });
    return data;
  },
};

export default policiesApi;
