// src/services/paymentsApi.js
import { api } from "@/api/http";

/**
 * Payments API
 *
 * Apto y alineado a tu backend actual (payments + policies):
 * - Los pagos están siempre asociados a una póliza y a un BillingPeriod
 * - El cliente NO lista payments globales
 * - El admin puede crear pagos manuales vía policies/{id}/mark-paid
 *
 * Nota importante:
 * - El frontend NO descarga PDFs desde payments
 * - Los comprobantes se consumen vía Receipt (file_url)
 */

export const paymentsApi = {
  // =====================================================
  // Cliente
  // =====================================================

  /**
   * Obtiene el período de facturación vigente de una póliza.
   * (estado, monto, fechas, etc.)
   *
   * GET /api/policies/{policyId}/billing/current/
   */
  async getCurrentBilling(policyId) {
    if (!policyId) {
      throw new Error("getCurrentBilling: policyId es requerido");
    }

    const { data } = await api.get(`/policies/${policyId}/billing/current/`);
    return data;
  },

  /**
   * (Opcional / futuro)
   * Si más adelante exponés pagos del cliente por póliza,
   * este método ya queda listo.
   *
   * GET /api/payments/?policy_id=...
   *
   * ⚠️ Hoy NO existe este endpoint en tu backend.
   */
  // async listPaymentsByPolicy(policyId) {
  //   if (!policyId) throw new Error("policyId requerido");
  //   const { data } = await api.get("/payments/", {
  //     params: { policy_id: policyId },
  //   });
  //   return data;
  // },

  // =====================================================
  // Admin
  // =====================================================

  /**
   * Marca un período como pagado manualmente.
   * Esto:
   * - crea Payment (si no existe)
   * - marca BillingPeriod como PAID
   * - genera Receipt + PDF
   *
   * POST /api/policies/{policyId}/mark-paid/
   */
  async markPolicyAsPaid(policyId) {
    if (!policyId) {
      throw new Error("markPolicyAsPaid: policyId es requerido");
    }

    const { data } = await api.post(`/policies/${policyId}/mark-paid/`);
    return data;
  },

  /**
   * (Admin) Refresca estado de una póliza y su billing.
   * Útil luego de acciones manuales.
   *
   * POST /api/policies/{policyId}/refresh/
   */
  async refreshPolicy(policyId) {
    if (!policyId) {
      throw new Error("refreshPolicy: policyId es requerido");
    }

    const { data } = await api.post(`/policies/${policyId}/refresh/`);
    return data;
  },
};

export default paymentsApi;
