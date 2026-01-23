import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../features/auth/authSlice";
import productsReducer from "../features/products/productsSlice";
import quotesReducer from "../features/quotes/quotesSlice";
import policiesReducer from "../features/policies/policiesSlice";
import paymentsReducer from "../features/payments/paymentsSlice";
import adminPoliciesReducer from "@/features/adminPolicies/adminPoliciesSlice";
import adminUsersReducer from "@/features/adminUsers/adminUsersSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    products: productsReducer,
    quotes: quotesReducer,
    policies: policiesReducer,
    payments: paymentsReducer,
    adminPolicies: adminPoliciesReducer,
    adminUsers: adminUsersReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false, // tokens, errors, FormData, etc.
    }),
});

export const selectAuth = (state) => state.auth;
