// frontend/src/services/adminSettingsApi.js
import { api } from "@/api/http";

/**
 * Backend expone AppSettings en:
 *   /api/admin/settings
 * y alias con slash.
 *
 * Como `api` ya suele tener baseURL "/api", acá usamos "/admin/settings".
 */
const BASE = "/admin/settings";

export const adminSettingsApi = {
  async get() {
    const { data } = await api.get(`${BASE}/`);
    return data;
  },

  async patch(payload) {
    const { data } = await api.patch(`${BASE}/`, payload);
    return data;
  },
};
