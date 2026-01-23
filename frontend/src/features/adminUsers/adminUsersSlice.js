// src/features/adminUsers/adminUsersSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminUsersApi } from "@/services/adminUsersApi";

export const fetchAdminUsers = createAsyncThunk(
  "adminUsers/fetchAdminUsers",
  async ({ page, page_size, q }, { rejectWithValue }) => {
    try {
      const data = await adminUsersApi.list({ page, page_size, q });
      return data;
    } catch (e) {
      return rejectWithValue("No se pudieron cargar los usuarios.");
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
        state.list = Array.isArray(action.payload?.results) ? action.payload.results : [];
        state.count = Number(action.payload?.count || 0);
      })
      .addCase(fetchAdminUsers.rejected, (state, action) => {
        state.loadingList = false;
        state.list = [];
        state.count = 0;
        state.errorList = action.payload || "Error cargando usuarios.";
      });
  },
});

export const { clearAdminUsersErrors, setAdminUsersPage, setAdminUsersQuery } =
  adminUsersSlice.actions;

export default adminUsersSlice.reducer;
