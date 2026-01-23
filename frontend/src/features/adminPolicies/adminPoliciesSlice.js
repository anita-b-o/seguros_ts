import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminPoliciesApi } from "@/services/adminPoliciesApi";

export const fetchAdminPolicies = createAsyncThunk(
  "adminPolicies/fetchList",
  async ({ page = 1 } = {}, { rejectWithValue }) => {
    try {
      return await adminPoliciesApi.list({ page });
    } catch (e) {
      return rejectWithValue(e?.response?.data || e?.message || "Error al listar pólizas");
    }
  }
);

export const createAdminPolicy = createAsyncThunk(
  "adminPolicies/create",
  async (payload, { rejectWithValue }) => {
    try {
      return await adminPoliciesApi.create(payload);
    } catch (e) {
      return rejectWithValue(e?.response?.data || e?.message || "Error al crear póliza");
    }
  }
);

export const patchAdminPolicy = createAsyncThunk(
  "adminPolicies/patch",
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      return await adminPoliciesApi.patch(id, payload);
    } catch (e) {
      return rejectWithValue(e?.response?.data || e?.message || "Error al editar póliza");
    }
  }
);

export const deleteAdminPolicy = createAsyncThunk(
  "adminPolicies/delete",
  async (id, { rejectWithValue }) => {
    try {
      await adminPoliciesApi.remove(id);
      return id;
    } catch (e) {
      return rejectWithValue(e?.response?.data || e?.message || "Error al eliminar póliza");
    }
  }
);

// ✅ NUEVO: marcar como abonada desde admin
export const markAdminPolicyPaid = createAsyncThunk(
  "adminPolicies/markPaid",
  async (id, { rejectWithValue }) => {
    try {
      // backend puede devolver { detail, payment_id, receipt_id, policy }
      return await adminPoliciesApi.markPaid(id);
    } catch (e) {
      return rejectWithValue(
        e?.response?.data || e?.message || "Error al marcar como abonada"
      );
    }
  }
);

const initialState = {
  list: [],
  count: 0,
  next: null,
  previous: null,
  page: 1,

  loadingList: false,
  loadingSave: false,
  loadingDelete: false,
  loadingMarkPaid: false,

  errorList: null,
  errorSave: null,
  errorMarkPaid: null,
  fieldErrors: null, // {product_id: [...], premium: [...], ...}
};

function normalizeFieldErrors(payload) {
  // DRF típicamente devuelve {field: [msg]}.
  if (!payload) return null;
  if (typeof payload === "string") return { _error: [payload] };
  if (Array.isArray(payload)) return { _error: payload.map(String) };
  if (typeof payload === "object") return payload;
  return { _error: [String(payload)] };
}

function coercePolicyFromResponse(payload) {
  // Aceptamos:
  // - policy directo
  // - o envoltorio { policy: {...} }
  if (!payload) return null;
  if (payload?.policy && typeof payload.policy === "object") return payload.policy;
  if (payload?.id) return payload;
  return null;
}

const adminPoliciesSlice = createSlice({
  name: "adminPolicies",
  initialState,
  reducers: {
    clearAdminPoliciesErrors(state) {
      state.errorList = null;
      state.errorSave = null;
      state.errorMarkPaid = null;
      state.fieldErrors = null;
    },
    setAdminPoliciesPage(state, action) {
      state.page = action.payload || 1;
    },
  },
  extraReducers: (builder) => {
    builder
      // LIST
      .addCase(fetchAdminPolicies.pending, (state) => {
        state.loadingList = true;
        state.errorList = null;
      })
      .addCase(fetchAdminPolicies.fulfilled, (state, action) => {
        state.loadingList = false;
        state.count = action.payload?.count ?? 0;
        state.next = action.payload?.next ?? null;
        state.previous = action.payload?.previous ?? null;
        state.list = action.payload?.results ?? [];
      })
      .addCase(fetchAdminPolicies.rejected, (state, action) => {
        state.loadingList = false;
        state.errorList = action.payload || "Error al listar pólizas";
      })

      // CREATE
      .addCase(createAdminPolicy.pending, (state) => {
        state.loadingSave = true;
        state.errorSave = null;
        state.fieldErrors = null;
      })
      .addCase(createAdminPolicy.fulfilled, (state, action) => {
        state.loadingSave = false;
        // Insertar al inicio para que se vea rápido (o podés re-fetch)
        state.list = [action.payload, ...state.list];
        state.count += 1;
      })
      .addCase(createAdminPolicy.rejected, (state, action) => {
        state.loadingSave = false;
        state.fieldErrors = normalizeFieldErrors(action.payload);
        state.errorSave = "No se pudo crear la póliza";
      })

      // PATCH
      .addCase(patchAdminPolicy.pending, (state) => {
        state.loadingSave = true;
        state.errorSave = null;
        state.fieldErrors = null;
      })
      .addCase(patchAdminPolicy.fulfilled, (state, action) => {
        state.loadingSave = false;
        const updated = action.payload;
        state.list = state.list.map((p) => (p.id === updated.id ? updated : p));
      })
      .addCase(patchAdminPolicy.rejected, (state, action) => {
        state.loadingSave = false;
        state.fieldErrors = normalizeFieldErrors(action.payload);
        state.errorSave = "No se pudo editar la póliza";
      })

      // DELETE
      .addCase(deleteAdminPolicy.pending, (state) => {
        state.loadingDelete = true;
      })
      .addCase(deleteAdminPolicy.fulfilled, (state, action) => {
        state.loadingDelete = false;
        const id = action.payload;
        state.list = state.list.filter((p) => p.id !== id);
        state.count = Math.max(0, state.count - 1);
      })
      .addCase(deleteAdminPolicy.rejected, (state, action) => {
        state.loadingDelete = false;
        state.errorList = action.payload || "No se pudo eliminar la póliza";
      })

      // MARK PAID
      .addCase(markAdminPolicyPaid.pending, (state) => {
        state.loadingMarkPaid = true;
        state.errorMarkPaid = null;
      })
      .addCase(markAdminPolicyPaid.fulfilled, (state, action) => {
        state.loadingMarkPaid = false;

        const updatedPolicy = coercePolicyFromResponse(action.payload);
        if (updatedPolicy?.id) {
          state.list = state.list.map((p) => (p.id === updatedPolicy.id ? updatedPolicy : p));
        }
      })
      .addCase(markAdminPolicyPaid.rejected, (state, action) => {
        state.loadingMarkPaid = false;
        state.errorMarkPaid = action.payload || "No se pudo marcar como abonada";
      });
  },
});

export const { clearAdminPoliciesErrors, setAdminPoliciesPage } = adminPoliciesSlice.actions;
export default adminPoliciesSlice.reducer;
