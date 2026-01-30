// src/app/routes.jsx
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";

// =========================
// Público
// =========================
import Home from "@/pages/Home";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";

// =========================
// Cotizaciones
// =========================
import QuoteRequest from "@/pages/quote/QuoteRequest";
import QuoteShared from "@/pages/quote/QuoteShared";

// =========================
// Admin (según árbol REAL)
// =========================
import AdminHome from "@/pages/admin/AdminHome";
import AdminPoliciesPage from "@/pages/admin/policies/AdminPoliciesPage";
import AdminUsersPage from "@/pages/admin/users/AdminUsersPage";
import Products from "@/pages/admin/products/Products";

// =========================
// Dashboard / Cliente
// =========================
import DashboardHome from "@/pages/dashboard/DashboardHome";
import AssociatePolicyPage from "@/pages/dashboard/AssociatePolicyPage";
import ReceiptsPage from "@/pages/dashboard/ReceiptsPage";
import ProfilePage from "@/pages/dashboard/ProfilePage";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* =========================
            Público
           ========================= */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* =========================
            Cotizaciones
           ========================= */}
        <Route path="/quote" element={<QuoteRequest />} />
        <Route path="/quote/share/:token" element={<QuoteShared />} />

        {/* =========================
            Admin
           ========================= */}
        <Route path="/admin" element={<Navigate to="/admin/home" replace />} />
        <Route path="/admin/home" element={<AdminHome />} />
        <Route path="/admin/policies" element={<AdminPoliciesPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/products" element={<Products />} />

        {/* =========================
            Usuario / Cliente (Dashboard)
           ========================= */}
        <Route
          path="/dashboard"
          element={<Navigate to="/dashboard/seguro" replace />}
        />
        <Route path="/dashboard/seguro" element={<DashboardHome />} />
        <Route
          path="/dashboard/associate-policy"
          element={<AssociatePolicyPage />}
        />
        <Route path="/dashboard/receipts" element={<ReceiptsPage />} />
        <Route path="/dashboard/profile" element={<ProfilePage />} />

        {/* =========================
            Fallback
           ========================= */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
