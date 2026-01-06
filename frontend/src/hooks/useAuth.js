import React from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import { ensureSingularNoTrailingSlash, USERS_ME } from "@/api/endpoints";

const AuthCtx = createContext(null);

const LS_USER = "sc_user";
const LS_ACCESS = "sc_access";
const LS_REFRESH = "sc_refresh";

function readLS(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeLS(key, val) {
  if (val === null || val === undefined) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(val));
}

function normalizeEmailInput(raw) {
  return (raw || "").toString().trim().toLowerCase();
}

const PROFILE_ENDPOINT = ensureSingularNoTrailingSlash(USERS_ME);

function getCurrentUser() {
  return api.get(PROFILE_ENDPOINT);
}

/** 🔐 Normaliza cualquier forma de “admin” a boolean estricto. */
function normalizeUser(u) {
  if (!u) return null;
  const role = (u.role || "").toString().toLowerCase();
  const raw = u.is_admin ?? u.isAdmin ?? u.is_staff ?? u.admin ?? role;

  let isAdmin = false;
  if (typeof raw === "boolean") isAdmin = raw;
  else if (typeof raw === "number") isAdmin = raw === 1;
  else if (typeof raw === "string") {
    const s = raw.toLowerCase().trim();
    isAdmin = s === "admin" || s === "true" || s === "1" || s === "yes" || s === "si";
  }

  return { ...u, is_admin: isAdmin };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => normalizeUser(readLS(LS_USER)));
  const [access, setAccess] = useState(() => readLS(LS_ACCESS));
  const [refresh, setRefresh] = useState(() => readLS(LS_REFRESH));
  const [loading, setLoading] = useState(true);

  // bandera para no hacer múltiples refresh en paralelo
  const refreshingRef = useRef(null);

  // ------ helpers ------
  function setSession({ user: u, access: a, refresh: r } = {}) {
    if (u !== undefined) {
      const nu = normalizeUser(u);
      setUser(nu);
      writeLS(LS_USER, nu);
    }
    if (a !== undefined) { setAccess(a); writeLS(LS_ACCESS, a); }
    if (r !== undefined) { setRefresh(r); writeLS(LS_REFRESH, r); }
  }

  async function hydrateUser() {
    // si tenés endpoint para mí mismo, podés revalidar
    try {
      if (!user && access) {
        // ⚠️ Ajustá la ruta si tu backend usa /me en vez de /users/me
        const { data } = await getCurrentUser();
        if (data) setSession({ user: data });
      }
    } catch {
      // si falla, no rompemos el inicio
    } finally {
      setLoading(false);
    }
  }

  // ------ acciones públicas ------
  async function login({ email, password, otp }) {
    const normalizedEmail = normalizeEmailInput(email);
    const payload = {
      email: normalizedEmail,
      password,
      ...(otp ? { otp } : {}),
    };
    const { data } = await api.post(
      "/accounts/jwt/create/",
      payload,
      { requiresAuth: false }
    );
    // Si el backend pide 2FA, devolvemos bandera y no seteamos sesión
    if (data?.require_otp) {
      return {
        require_otp: true,
        detail: data.detail,
        otp_sent_to: data.otp_sent_to,
        otp_ttl_seconds: data.otp_ttl_seconds,
      };
    }
    // se espera: { user, access, refresh } (o nombres equivalentes)
    const accessToken = data?.access;
    const refreshToken = data?.refresh;
    if (!accessToken || !refreshToken) {
      throw new Error("Timeout inesperado en login.");
    }

    setSession({ access: accessToken, refresh: refreshToken });

    try {
      // usamos el endpoint exacto sin slash final para evitar 404 del backend
      const { data: profile } = await getCurrentUser();
      setSession({ user: profile });
      return normalizeUser(profile);
    } catch (profileError) {
      const message =
        profileError?.response?.data?.detail ||
        profileError?.response?.data?.error ||
        "No pudimos cargar tus datos.";
      const err = new Error(message);
      err.response = profileError?.response;
      throw err;
    }
  }

  async function googleLogin({ id_token }) {
    const { data } = await api.post(
      "/auth/google",
      { id_token },
      { requiresAuth: false }
    );
    setSession({ user: data.user, access: data.access, refresh: data.refresh });
    return normalizeUser(data.user);
  }

  async function register(payload) {
    // ejemplo payload: { first_name, last_name, email, dni, phone, dob, password }
    const { data } = await api.post("/auth/register", payload, {
      requiresAuth: false,
    });
    if (data?.access) setSession({ user: data.user, access: data.access, refresh: data.refresh });
    // devolvemos lo que venga pero normalizamos user si existe
    return data?.user ? { ...data, user: normalizeUser(data.user) } : data;
  }

  function logout() {
    setSession({ user: null, access: null, refresh: null });
  }

  // ------ refresh token centralizado ------
  async function refreshTokenOnce() {
    if (refreshingRef.current) return refreshingRef.current;
    if (!refresh) throw new Error("No refresh token");

    const p = (async () => {
      try {
        const { data } = await api.post(
          "/accounts/jwt/refresh/",
          { refresh },
          { requiresAuth: false }
        );
        if (!data?.access) throw new Error("No access in refresh");
        // algunos backends devuelven también el user actualizado
        setSession({ access: data.access, user: data.user ?? user });
        return data.access;
      } catch (e) {
        logout();
        throw e;
      } finally {
        refreshingRef.current = null;
      }
    })();

    refreshingRef.current = p;
    return p;
  }

  // ------ efecto de inicio ------
  useEffect(() => {
    hydrateUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // memo del valor del contexto
  const value = useMemo(() => ({
    user,
    loading,
    login,
    googleLogin,
    register,
    logout,
    setSession,
    access,       // expuesto por si hace falta
    refreshTokenOnce,
  }), [user, loading, access]);

  return React.createElement(AuthCtx.Provider, { value }, children);
}

export default function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
