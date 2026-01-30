// src/app/store.js
import { configureStore } from "@reduxjs/toolkit";

import authReducer from "@/features/auth/authSlice";
import productsReducer from "@/features/products/productsSlice";
import quotesReducer from "@/features/quotes/quotesSlice";
import policiesReducer from "@/features/policies/policiesSlice";
import paymentsReducer from "@/features/payments/paymentsSlice";
import adminPoliciesReducer from "@/features/adminPolicies/adminPoliciesSlice";
import adminUsersReducer from "@/features/adminUsers/adminUsersSlice";
import policiesAssociateReducer from "@/features/policiesAssociate/policiesAssociateSlice";
import receiptsReducer from "@/features/receipts/receiptsSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    products: productsReducer,
    quotes: quotesReducer,
    policies: policiesReducer,
    payments: paymentsReducer,
    adminPolicies: adminPoliciesReducer,
    adminUsers: adminUsersReducer,
    policiesAssociate: policiesAssociateReducer,
    receipts: receiptsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

// ✅ ESTE EXPORT ES OBLIGATORIO
export const selectAuth = (state) => state.auth;
