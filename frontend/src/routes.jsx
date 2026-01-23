// src/app/routes.jsx
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";

// Público
import Home from "@/pages/Home";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";

// Quote
import QuoteRequest from "@/pages/quote/QuoteRequest";
import QuoteShared from "@/pages/quote/QuoteShared";

// Admin (según tu árbol REAL)
import AdminHome from "@/pages/admin/AdminHome";
import Policies from "@/pages/admin/policies/AdminPoliciesPage"; // Ojo: tu admin real está acá
import AdminUsersPage from "@/pages/admin/users/AdminUsersPage";
import Products from "@/pages/admin/products/Products";

// (Opcional) Si querés mantener la pantalla placeholder
function Placeholder({ title }) {
  return (
    <div style={{ padding: 24 }}>
      <h2>{title}</h2>
      <p>Pantalla en construcción.</p>
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Público */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Cotizaciones */}
        <Route path="/quote" element={<QuoteRequest />} />
        <Route path="/quote/share/:token" element={<QuoteShared />} />

        {/* Admin */}
        <Route path="/admin" element={<Navigate to="/admin/home" replace />} />
        <Route path="/admin/home" element={<AdminHome />} />
        <Route path="/admin/policies" element={<Policies />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/products" element={<Products />} />

        {/* Usuario */}
        <Route path="/dashboard/seguro" element={<Placeholder title="Panel de usuario" />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
