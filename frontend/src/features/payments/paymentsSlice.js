import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  pendingByPolicy: {},
};

const slice = createSlice({
  name: "payments",
  initialState,
  reducers: {
    setPending(state, action) {
      const { policyId, pending } = action.payload || {};
      if (!policyId) return;
      state.pendingByPolicy[String(policyId)] = pending || null;
    },
  },
});

export const { setPending } = slice.actions;
export default slice.reducer;
