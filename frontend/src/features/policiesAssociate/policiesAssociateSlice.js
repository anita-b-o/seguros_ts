// src/features/policiesAssociate/policiesAssociateSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { policiesApi } from "@/services/policiesApi";

export const associatePolicyByNumber = createAsyncThunk(
  "policiesAssociate/associatePolicyByNumber",
  async ({ policy_number }, { rejectWithValue }) => {
    try {
      // Backend espera: POST /policies/claim  { number: "..." }
      const data = await policiesApi.claimPolicy({ numberOrCode: policy_number });
      return data;
    } catch (err) {
      const status = err?.response?.status;

      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        "No se pudo asociar la póliza.";

      return rejectWithValue({ status, detail });
    }
  }
);

const initialState = {
  loading: false,
  error: null,
  lastAssociated: null,
};

const slice = createSlice({
  name: "policiesAssociate",
  initialState,
  reducers: {
    clearAssociateState(state) {
      state.loading = false;
      state.error = null;
      state.lastAssociated = null;
    },
    clearAssociateError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(associatePolicyByNumber.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.lastAssociated = null;
      })
      .addCase(associatePolicyByNumber.fulfilled, (state, action) => {
        state.loading = false;
        state.lastAssociated = action.payload;
      })
      .addCase(associatePolicyByNumber.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || { detail: "Error inesperado." };
      });
  },
});

export const { clearAssociateState, clearAssociateError } = slice.actions;
export default slice.reducer;
