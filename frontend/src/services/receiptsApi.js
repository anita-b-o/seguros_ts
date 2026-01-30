// src/services/receiptsApi.js
import { api } from "@/api/http";
import { policiesApi } from "@/services/policiesApi";

/**
 * Receipts API (cliente)
 *
 * Este módulo es un "facade" para la pantalla de Comprobantes:
 * - Pólizas del cliente: /api/policies/my  (via policiesApi)
 * - Comprobantes:        /api/policies/{id}/receipts (paginado)
 * - Período vigente:     /api/policies/{id}/billing/current
 *
 * Nota:
 * - La descarga del PDF se hace vía `file_url` (si el backend devuelve esa URL).
 * - Si el backend expone otro endpoint de descarga, adaptalo acá.
 */
export const receiptsApi = {
  // -----------------------
  // Pólizas del cliente (para listado en ReceiptsPage)
  // -----------------------
  async listMyPolicies() {
    // Reutilizamos policiesApi que ya tenés bien alineado
    return await policiesApi.listMyPolicies();
  },

  // -----------------------
  // Comprobantes paginados por póliza
  // -----------------------
  async listReceiptsByPolicy(policyId, page = 1, pageSize = 10) {
    if (!policyId) throw new Error("listReceiptsByPolicy: policyId es requerido");

    // Usamos tu policiesApi.listReceipts que ya hace:
    // GET /policies/{id}/receipts?page=&page_size=
    return await policiesApi.listReceipts(policyId, { page, pageSize });
  },

  // -----------------------
  // “Pendientes” = BillingPeriod vigente
  // -----------------------
  async getBillingCurrentByPolicy(policyId) {
    if (!policyId) throw new Error("getBillingCurrentByPolicy: policyId es requerido");
    return await policiesApi.getBillingCurrent(policyId);
  },

  // -----------------------
  // Descargar PDF (vía file_url)
  // -----------------------
  async downloadReceiptPdfByFileUrl(fileUrl) {
    if (!fileUrl) throw new Error("downloadReceiptPdfByFileUrl: fileUrl es requerido");

    // Si fileUrl viene absoluto (http...), axios lo soporta.
    // responseType blob para descargar PDF.
    const res = await api.get(fileUrl, { responseType: "blob" });
    return res.data; // Blob
  },

  /**
   * Compat: tu ReceiptModal usa downloadReceiptPdfThunk(policyId, receiptId).
   * Si NO existe endpoint directo para PDF, vamos a necesitar el receipt con file_url.
   * Solución: en el thunk vamos a bajar por file_url.
   *
   * Este método queda por si en algún momento agregás endpoint:
   * GET /policies/{policyId}/receipts/{receiptId}/pdf
   */
  async downloadReceiptPdf(policyId, receiptId) {
    throw new Error(
      "downloadReceiptPdf: no hay endpoint PDF directo. Usá downloadReceiptPdfByFileUrl(file_url)."
    );
  },
};

export default receiptsApi;
