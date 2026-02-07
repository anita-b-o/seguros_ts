import { api, apiPublic } from "./http";

function isAdult(birthDate) {
  if (!birthDate) return false;
  const today = new Date();
  const birth = new Date(birthDate);

  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 18;
}

export const authApi = {
  normalizeError(err) {
    const data = err?.response?.data;
    if (!data) return err?.message || "Error";
    if (typeof data === "string") return data;
    if (data.detail) return data.detail;
    const firstKey = Object.keys(data)[0];
    if (firstKey) {
      const val = data[firstKey];
      if (Array.isArray(val)) return val[0];
      if (typeof val === "string") return val;
    }
    return "Error";
  },

  async login({ email, password, otp }) {
    // ✅ Contract: POST /api/auth/login
    const body = { email, password };
    if (otp) body.otp = otp;

    const res = await apiPublic.post("/auth/login", body, {
      validateStatus: () => true,
    });

    // 202 => requiere OTP
    if (res.status === 202) return res.data;

    if (res.status >= 200 && res.status < 300) return res.data;

    const e = new Error("Login failed");
    e.response = { data: res.data, status: res.status };
    throw e;
  },

  async refresh() {
    // ✅ Contract: POST /api/auth/refresh
    const res = await apiPublic.post("/auth/refresh", {});
    return res.data;
  },

  async logout() {
    // Best-effort
    return apiPublic.post("/auth/logout", {}, { validateStatus: () => true });
  },

  async register(payload) {
    // ✅ Restricción +18 también defensiva acá
    if (!isAdult(payload.birth_date)) {
      const e = new Error("Debés ser mayor de 18 años para registrarte.");
      e.code = "UNDERAGE";
      throw e;
    }
    const res = await apiPublic.post("/auth/register", payload);
    return res.data;
  },

  async googleStatus() {
    const res = await apiPublic.get("/auth/google/status", {
      validateStatus: () => true,
    });
    return res.data;
  },

  async googleLogin({ idToken }) {
    const res = await apiPublic.post(
      "/auth/google",
      { id_token: idToken },
      { validateStatus: () => true }
    );
    if (res.status >= 200 && res.status < 300) return res.data;

    const e = new Error("Google login failed");
    e.response = { data: res.data, status: res.status };
    throw e;
  },

  async me() {
    const res = await api.get("/accounts/users/me");
    return res.data;
  },
};
