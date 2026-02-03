import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminUsersApi } from "@/services/adminUsersApi";

export const fetchAdminUsers = createAsyncThunk(
  "adminUsers/fetchAdminUsers",
  async ({ page, page_size, q }, { rejectWithValue }) => {
    try {
      const data = await adminUsersApi.list({ page, page_size, q });
      return data;
    } catch (e) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        e?.message ||
        "Error desconocido";
      return rejectWithValue(detail);
    }
  }
);

export const deleteAdminUser = createAsyncThunk(
  "adminUsers/delete",
  async (id, { rejectWithValue }) => {
    try {
      await adminUsersApi.remove(id);
      return id;
    } catch (e) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        e?.message ||
        "Error desconocido";
      return rejectWithValue(detail);
    }
  }
);

const initialState = {
  list: [],
  count: 0,
  page: 1,
  pageSize: 10,
  q: "",
  loadingList: false,
  loadingDelete: false,
  errorList: "",
};

const adminUsersSlice = createSlice({
  name: "adminUsers",
  initialState,
  reducers: {
    clearAdminUsersErrors(state) {
      state.errorList = "";
    },
    setAdminUsersPage(state, action) {
      state.page = action.payload;
    },
    setAdminUsersQuery(state, action) {
      state.q = action.payload;
      state.page = 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminUsers.pending, (state) => {
        state.loadingList = true;
        state.errorList = "";
      })
      .addCase(fetchAdminUsers.fulfilled, (state, action) => {
        state.loadingList = false;

        const payload = action.payload;

        // ✅ CASO 1: backend devuelve array simple
        if (Array.isArray(payload)) {
          state.list = payload;
          state.count = payload.length;
          return;
        }

        // ✅ CASO 2: backend devuelve paginado DRF
        if (payload && typeof payload === "object") {
          state.list = Array.isArray(payload.results) ? payload.results : [];
          state.count = Number(payload.count || state.list.length || 0);
          return;
        }

        // fallback defensivo
        state.list = [];
        state.count = 0;
      })
      .addCase(fetchAdminUsers.rejected, (state, action) => {
        state.loadingList = false;
        state.list = [];
        state.count = 0;
        state.errorList = action.payload || "Error cargando usuarios.";
      })
      .addCase(deleteAdminUser.pending, (state) => {
        state.loadingDelete = true;
        state.errorList = "";
      })
      .addCase(deleteAdminUser.fulfilled, (state, action) => {
        state.loadingDelete = false;
        const id = action.payload;
        state.list = state.list.filter((u) => u.id !== id);
        state.count = Math.max(0, state.count - 1);
      })
      .addCase(deleteAdminUser.rejected, (state, action) => {
        state.loadingDelete = false;
        state.errorList = action.payload || "Error eliminando usuario.";
      });
  },
});

export const {
  clearAdminUsersErrors,
  setAdminUsersPage,
  setAdminUsersQuery,
} = adminUsersSlice.actions;

export default adminUsersSlice.reducer;
