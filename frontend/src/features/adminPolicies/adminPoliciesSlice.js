import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminPoliciesApi } from "@/services/adminPoliciesApi";

/**
 * LIST
 * - Guarda status/http para poder autocorregir paginado fuera de rango (404)
 * - Inyecta __page para mantener el page real pedido
 */
export const fetchAdminPolicies = createAsyncThunk(
  "adminPolicies/fetchList",
  async ({ page = 1 } = {}, { rejectWithValue }) => {
    try {
      const data = await adminPoliciesApi.list({ page });
      return { ...data, __page: page };
    } catch (e) {
      return rejectWithValue({
        status: e?.response?.status ?? 0,
        data: e?.response?.data ?? null,
        message: e?.message || "Error al listar pólizas",
        page,
      });
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

  // page actual seleccionado en UI
  page: 1,

  // ✅ ayuda para calcular lastPage (tu backend usa 10 por defecto en policies/pagination.py)
  pageSize: 10,

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
    // opcional (si algún día querés soportar page_size desde UI)
    setAdminPoliciesPageSize(state, action) {
      const n = Number(action.payload);
      state.pageSize = Number.isFinite(n) && n > 0 ? n : 10;
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

        // ✅ mantenemos coherente el page con lo que pedimos
        state.page = action.payload?.__page ?? state.page;

        state.count = action.payload?.count ?? 0;
        state.next = action.payload?.next ?? null;
        state.previous = action.payload?.previous ?? null;
        state.list = action.payload?.results ?? [];
      })
      .addCase(fetchAdminPolicies.rejected, (state, action) => {
        state.loadingList = false;

        const payload = action.payload;

        // ✅ Si el backend devuelve 404 por página fuera de rango (ej: page=4 y solo hay 3),
        // retrocedemos una página y no mostramos error.
        if (payload?.status === 404 && state.page > 1) {
          state.page = Math.max(1, state.page - 1);
          state.errorList = null;
          return;
        }

        state.errorList =
          payload?.data || payload?.message || "Error al listar pólizas";
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
          state.list = state.list.map((p) =>
            p.id === updatedPolicy.id ? updatedPolicy : p
          );
        }
      })
      .addCase(markAdminPolicyPaid.rejected, (state, action) => {
        state.loadingMarkPaid = false;
        state.errorMarkPaid = action.payload || "No se pudo marcar como abonada";
      });
  },
});

export const {
  clearAdminPoliciesErrors,
  setAdminPoliciesPage,
  setAdminPoliciesPageSize,
} = adminPoliciesSlice.actions;

export default adminPoliciesSlice.reducer;
