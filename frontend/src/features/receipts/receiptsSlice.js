// src/features/receipts/receiptsSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { receiptsApi } from "@/services/receiptsApi";

const key = (policyId, page) => `${policyId}:${page}`;

// =======================
// Thunks
// =======================

export const fetchClientPolicies = createAsyncThunk(
  "receipts/fetchClientPolicies",
  async (_, { rejectWithValue }) => {
    try {
      const data = await receiptsApi.listMyPolicies();

      // Tolerante: backend puede devolver array directo o {results:[]}
      const policies = Array.isArray(data) ? data : data?.results || [];
      return policies;
    } catch (err) {
      return rejectWithValue({
        status: err?.response?.status,
        detail:
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          "No se pudieron cargar las pólizas.",
      });
    }
  }
);

export const fetchReceiptsByPolicyPage = createAsyncThunk(
  "receipts/fetchReceiptsByPolicyPage",
  async ({ policyId, page, pageSize = 10 }, { rejectWithValue }) => {
    try {
      const data = await receiptsApi.listReceiptsByPolicy(policyId, page, pageSize);
      return { policyId, page, pageSize, data };
    } catch (err) {
      return rejectWithValue({
        policyId,
        page,
        status: err?.response?.status,
        detail:
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          "No se pudieron cargar los comprobantes.",
      });
    }
  }
);

/**
 * ✅ BillingPeriod vigente por póliza (para pestaña "Período vigente" / "Pendientes")
 */
export const fetchBillingCurrentByPolicy = createAsyncThunk(
  "receipts/fetchBillingCurrentByPolicy",
  async ({ policyId }, { rejectWithValue }) => {
    try {
      const data = await receiptsApi.getBillingCurrentByPolicy(policyId);
      return { policyId, data };
    } catch (err) {
      return rejectWithValue({
        policyId,
        status: err?.response?.status,
        detail:
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          "No se pudo cargar el período vigente.",
      });
    }
  }
);

/**
 * ✅ Descargar PDF (ARREGLADO)
 * No hay endpoint directo /pdf, entonces:
 * - usamos receipt.file_url (o variantes) para pedir blob
 *
 * ReceiptModal ya tiene policy + receipt dentro de selectedReceipt, así que
 * desde acá podemos acceder al receipt para sacar el file_url.
 */
export const downloadReceiptPdfThunk = createAsyncThunk(
  "receipts/downloadReceiptPdf",
  async ({ policyId, receiptId }, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const selected = state?.receipts?.selectedReceipt;
      const receipt = selected?.receipt;

      // Validación básica
      if (!receipt || String(receipt?.id) !== String(receiptId)) {
        return rejectWithValue({
          policyId,
          receiptId,
          status: 400,
          detail:
            "No se encontró el comprobante seleccionado para descargar (receipt no disponible en el estado).",
        });
      }

      const fileUrl =
        receipt?.file_url ||
        receipt?.fileUrl ||
        receipt?.pdf_url ||
        receipt?.pdfUrl ||
        receipt?.document_url ||
        receipt?.documentUrl ||
        null;

      if (!fileUrl) {
        return rejectWithValue({
          policyId,
          receiptId,
          status: 422,
          detail:
            "Este comprobante no tiene file_url (URL de PDF) en la respuesta del backend.",
        });
      }

      const blob = await receiptsApi.downloadReceiptPdfByFileUrl(fileUrl);
      return { policyId, receiptId, blob };
    } catch (err) {
      return rejectWithValue({
        policyId,
        receiptId,
        status: err?.response?.status,
        detail:
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err?.message ||
          "No se pudo descargar el comprobante.",
      });
    }
  }
);

// =======================
// Slice
// =======================

const initialState = {
  policies: [],
  policiesLoading: false,
  policiesError: null,

  // receiptsByPolicyPage["policyId:page"] = { loading, error, page, pageSize, count, results, next, previous }
  receiptsByPolicyPage: {},

  // billingCurrentByPolicy[policyId] = { loading, error, data }
  billingCurrentByPolicy: {},

  // downloadByReceiptId[receiptId] = { loading, error, blob? }
  downloadByReceiptId: {},

  // UI
  selectedPolicyId: null,
  selectedReceipt: null, // { policy, receipt }
  receiptModalOpen: false,
};

const slice = createSlice({
  name: "receipts",
  initialState,
  reducers: {
    clearReceiptsErrors(state) {
      state.policiesError = null;

      Object.values(state.receiptsByPolicyPage).forEach((v) => {
        if (v) v.error = null;
      });

      Object.values(state.billingCurrentByPolicy).forEach((v) => {
        if (v) v.error = null;
      });

      Object.values(state.downloadByReceiptId).forEach((v) => {
        if (v) v.error = null;
      });
    },

    setSelectedPolicy(state, action) {
      state.selectedPolicyId = action.payload ?? null;
    },

    openReceiptModal(state, action) {
      // Esperado: { policy, receipt }
      state.receiptModalOpen = true;
      state.selectedReceipt = action.payload || null;

      // Limpieza de estado de descarga previo para este receipt (mejor UX)
      const rid = action.payload?.receipt?.id;
      if (rid != null) {
        state.downloadByReceiptId[rid] = { loading: false, error: null, blob: null };
      }
    },

    closeReceiptModal(state) {
      state.receiptModalOpen = false;
      state.selectedReceipt = null;
    },
  },

  extraReducers: (builder) => {
    // ----- policies -----
    builder
      .addCase(fetchClientPolicies.pending, (state) => {
        state.policiesLoading = true;
        state.policiesError = null;
      })
      .addCase(fetchClientPolicies.fulfilled, (state, action) => {
        state.policiesLoading = false;
        state.policies = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(fetchClientPolicies.rejected, (state, action) => {
        state.policiesLoading = false;
        state.policiesError = action.payload?.detail || "Error inesperado.";
      });

    // ----- receipts paginated -----
    builder
      .addCase(fetchReceiptsByPolicyPage.pending, (state, action) => {
        const { policyId, page, pageSize = 10 } = action.meta.arg;
        const k = key(policyId, page);
        state.receiptsByPolicyPage[k] = {
          ...(state.receiptsByPolicyPage[k] || {}),
          loading: true,
          error: null,
          policyId,
          page,
          pageSize,
        };
      })
      .addCase(fetchReceiptsByPolicyPage.fulfilled, (state, action) => {
        const { policyId, page, pageSize, data } = action.payload;
        const k = key(policyId, page);
        state.receiptsByPolicyPage[k] = {
          loading: false,
          error: null,
          policyId,
          page,
          pageSize,
          count: data?.count ?? 0,
          results: data?.results ?? [],
          next: data?.next ?? null,
          previous: data?.previous ?? null,
        };
      })
      .addCase(fetchReceiptsByPolicyPage.rejected, (state, action) => {
        const policyId = action.payload?.policyId ?? action.meta.arg.policyId;
        const page = action.payload?.page ?? action.meta.arg.page;
        const pageSize = action.meta.arg.pageSize ?? 10;
        const k = key(policyId, page);
        state.receiptsByPolicyPage[k] = {
          ...(state.receiptsByPolicyPage[k] || {}),
          loading: false,
          error: action.payload?.detail || "Error inesperado.",
          policyId,
          page,
          pageSize,
        };
      });

    // ----- billing current -----
    builder
      .addCase(fetchBillingCurrentByPolicy.pending, (state, action) => {
        const { policyId } = action.meta.arg;
        state.billingCurrentByPolicy[policyId] = {
          ...(state.billingCurrentByPolicy[policyId] || {}),
          loading: true,
          error: null,
          data: state.billingCurrentByPolicy[policyId]?.data ?? null,
        };
      })
      .addCase(fetchBillingCurrentByPolicy.fulfilled, (state, action) => {
        const { policyId, data } = action.payload;
        state.billingCurrentByPolicy[policyId] = {
          loading: false,
          error: null,
          data: data ?? null,
        };
      })
      .addCase(fetchBillingCurrentByPolicy.rejected, (state, action) => {
        const policyId = action.payload?.policyId ?? action.meta.arg.policyId;
        state.billingCurrentByPolicy[policyId] = {
          ...(state.billingCurrentByPolicy[policyId] || {}),
          loading: false,
          error: action.payload?.detail || "Error inesperado.",
          data: state.billingCurrentByPolicy[policyId]?.data ?? null,
        };
      });

    // ----- download receipt pdf -----
    builder
      .addCase(downloadReceiptPdfThunk.pending, (state, action) => {
        const { receiptId } = action.meta.arg || {};
        if (receiptId != null) {
          state.downloadByReceiptId[receiptId] = {
            ...(state.downloadByReceiptId[receiptId] || {}),
            loading: true,
            error: null,
            blob: null,
          };
        }
      })
      .addCase(downloadReceiptPdfThunk.fulfilled, (state, action) => {
        const { receiptId, blob } = action.payload || {};
        if (receiptId != null) {
          state.downloadByReceiptId[receiptId] = {
            loading: false,
            error: null,
            blob: blob ?? null,
          };
        }
      })
      .addCase(downloadReceiptPdfThunk.rejected, (state, action) => {
        const receiptId = action.payload?.receiptId ?? action.meta.arg?.receiptId;
        if (receiptId != null) {
          state.downloadByReceiptId[receiptId] = {
            ...(state.downloadByReceiptId[receiptId] || {}),
            loading: false,
            error: action.payload?.detail || "Error inesperado.",
          };
        }
      });
  },
});

// Exports de actions
export const {
  clearReceiptsErrors,
  setSelectedPolicy,
  openReceiptModal,
  closeReceiptModal,
} = slice.actions;

// Helpers para UI (ReceiptsPage.jsx importa receiptsKey)
export const receiptsKey = key;

// Default export para store.js
export default slice.reducer;

// Selectors opcionales
export const selectReceiptModalState = (state) => ({
  open: state.receipts.receiptModalOpen,
  selected: state.receipts.selectedReceipt,
});

export const selectDownloadStateByReceiptId = (state, receiptId) =>
  state.receipts.downloadByReceiptId?.[receiptId] || { loading: false, error: null, blob: null };
