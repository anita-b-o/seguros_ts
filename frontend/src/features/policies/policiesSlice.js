import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  // =========================
  // Lo que ya funcionaba
  // =========================
  items: [],          // listado de pólizas (dropdown / grilla)
  selected: null,     // póliza seleccionada
  receipts: [],       // recibos de la póliza seleccionada (results)

  // =========================
  // Nuevo (NO rompe lo viejo)
  // =========================
  receiptsPagination: {
    count: 0,
    page: 1,
    pageSize: 10,
    next: null,
    previous: null,
  },

  loading: false,
  error: null,
};

const slice = createSlice({
  name: "policies",
  initialState,
  reducers: {
    // -------------------------
    // Existentes (sin cambios)
    // -------------------------
    setPolicies(state, action) {
      state.items = action.payload || [];
    },

    setSelectedPolicy(state, action) {
      state.selected = action.payload || null;
    },

    /**
     * Sigue funcionando si le pasás:
     * - un array (modo legacy)
     * - o un objeto paginado DRF
     */
    setReceipts(state, action) {
      const payload = action.payload;

      // 🔹 Modo viejo: array directo
      if (Array.isArray(payload)) {
        state.receipts = payload;
        state.receiptsPagination = {
          ...state.receiptsPagination,
          count: payload.length,
          next: null,
          previous: null,
        };
        return;
      }

      // 🔹 Modo nuevo: paginado DRF
      state.receipts = payload?.results || [];
      state.receiptsPagination = {
        count: payload?.count ?? 0,
        next: payload?.next ?? null,
        previous: payload?.previous ?? null,
        page: payload?.page ?? state.receiptsPagination.page,
        pageSize: payload?.page_size ?? state.receiptsPagination.pageSize,
      };
    },

    // -------------------------
    // Nuevos helpers (optativos)
    // -------------------------
    setReceiptsPage(state, action) {
      state.receiptsPagination.page = action.payload || 1;
    },

    setReceiptsPageSize(state, action) {
      state.receiptsPagination.pageSize = action.payload || 10;
    },

    setLoading(state, action) {
      state.loading = Boolean(action.payload);
    },

    setError(state, action) {
      state.error = action.payload || null;
    },

    clearError(state) {
      state.error = null;
    },
  },
});

export const {
  setPolicies,
  setSelectedPolicy,
  setReceipts,
  setReceiptsPage,
  setReceiptsPageSize,
  setLoading,
  setError,
  clearError,
} = slice.actions;

export default slice.reducer;
