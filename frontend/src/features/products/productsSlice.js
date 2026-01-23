import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { apiPublic } from "../../api/http";

const initialState = {
  status: "idle",
  items: [],
  error: null,
};

export const fetchHomeProducts = createAsyncThunk(
  "products/fetchHome",
  async (_, { rejectWithValue }) => {
    try {
      const res = await apiPublic.get("/products/home");
      return res.data;
    } catch (err) {
      return rejectWithValue(err?.response?.data?.detail || err?.message || "Error");
    }
  }
);

const slice = createSlice({
  name: "products",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchHomeProducts.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchHomeProducts.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.items = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(fetchHomeProducts.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Error";
      });
  },
});

export default slice.reducer;
