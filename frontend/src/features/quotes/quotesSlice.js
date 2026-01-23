import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  draft: {},
  lastQuote: null,
  shareToken: null,
};

const slice = createSlice({
  name: "quotes",
  initialState,
  reducers: {
    setDraft(state, action) {
      state.draft = { ...state.draft, ...(action.payload || {}) };
    },
    clearDraft(state) {
      state.draft = {};
    },
    setLastQuote(state, action) {
      state.lastQuote = action.payload || null;
    },
    setShareToken(state, action) {
      state.shareToken = action.payload || null;
    },
  },
});

export const { setDraft, clearDraft, setLastQuote, setShareToken } = slice.actions;
export default slice.reducer;
