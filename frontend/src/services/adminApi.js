/**
 * Admin API service.
 * Centraliza endpoints del panel admin para evitar desalineaciones con el backend.
 *
 * @typedef {Object} ApiListResponse
 * @property {any[]} results
 * @property {number} [count]
 * @property {string|null} [next]
 * @property {string|null} [previous]
 *
 * @typedef {Object} AdminUser
 * @property {number|string} id
 * @property {string} [dni]
 * @property {string} [email]
 * @property {string} [first_name]
 * @property {string} [last_name]
 * @property {string} [role]
 *
 * @typedef {Object} InsuranceType
 * @property {number|string} id
 * @property {string} name
 * @property {string} [description]
 * @property {number} [base_price]
 *
 * @typedef {Object} AdminPolicy
 * @property {number|string} id
 * @property {string} [status]
 * @property {string} [created_at]
 * @property {any} [user]
 *
 * @typedef {Object} AdminSettings
 * @property {boolean} [allow_payments]
 * @property {boolean} [maintenance_mode]
 */

// src/services/adminApi.js
import { api } from "@/api";

/**
 * Centraliza endpoints del panel admin para evitar desalineación con el backend.
 * Todos los paths son relativos a API_BASE (p.ej. http://127.0.0.1:8000/api).
 */
export const ADMIN_ENDPOINTS = Object.freeze({
  POLICIES: "/admin/policies/policies",
  USERS: "/admin/accounts/users",
  INSURANCE_TYPES: "/admin/products/insurance-types",
  SETTINGS: "/common/admin/settings/",
  PAYMENTS_PENDING: "/payments/pending",
});

/* ===================== Policies ===================== */
export async function listAdminPolicies(config = {}) {
  return api.get(ADMIN_ENDPOINTS.POLICIES, config);
}

export async function patchAdminPolicy(policyId, payload, config = {}) {
  return api.patch(`${ADMIN_ENDPOINTS.POLICIES}/${policyId}`, payload, config);
}

export async function createAdminPolicy(payload, config = {}) {
  return api.post(ADMIN_ENDPOINTS.POLICIES, payload, config);
}


/* ===================== Users ===================== */
export async function listAdminUsers(config = {}) {
  return api.get(ADMIN_ENDPOINTS.USERS, config);
}

export async function createAdminUser(payload, config = {}) {
  return api.post(ADMIN_ENDPOINTS.USERS, payload, config);
}

export async function patchAdminUser(userId, payload, config = {}) {
  return api.patch(`${ADMIN_ENDPOINTS.USERS}/${userId}`, payload, config);
}

/* ===================== Insurance Types ===================== */
export async function listAdminInsuranceTypes(config = {}) {
  return api.get(ADMIN_ENDPOINTS.INSURANCE_TYPES, config);
}

export async function createAdminInsuranceType(payload, config = {}) {
  return api.post(ADMIN_ENDPOINTS.INSURANCE_TYPES, payload, config);
}

export async function patchAdminInsuranceType(typeId, payload, config = {}) {
  return api.patch(`${ADMIN_ENDPOINTS.INSURANCE_TYPES}/${typeId}`, payload, config);
}

export async function deleteAdminInsuranceType(typeId, config = {}) {
  return api.delete(`${ADMIN_ENDPOINTS.INSURANCE_TYPES}/${typeId}`, config);
}

/* ===================== Settings ===================== */
export async function getAdminSettings(config = {}) {
  return api.get(ADMIN_ENDPOINTS.SETTINGS, config);
}

export async function patchAdminSettings(payload, config = {}) {
  return api.patch(ADMIN_ENDPOINTS.SETTINGS, payload, config);
}

/* ===================== Payments ===================== */
export async function listPendingPayments(config = {}) {
  return api.get(ADMIN_ENDPOINTS.PAYMENTS_PENDING, config);
}
