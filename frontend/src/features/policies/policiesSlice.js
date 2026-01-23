import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  items: [],
  selected: null,
  receipts: [],
};

const slice = createSlice({
  name: "policies",
  initialState,
  reducers: {
    setPolicies(state, action) {
      state.items = action.payload || [];
    },
    setSelectedPolicy(state, action) {
      state.selected = action.payload || null;
    },
    setReceipts(state, action) {
      state.receipts = action.payload || [];
    },
  },
});

export const { setPolicies, setSelectedPolicy, setReceipts } = slice.actions;
export default slice.reducer;
