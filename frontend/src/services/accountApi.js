import { api } from "@/api/http";

export const accountApi = {
  async getMe() {
    const { data } = await api.get("/accounts/users/me/");
    return data;
  },

  /**
   * Cambiar contraseña del usuario autenticado
   * Requiere backend:
   * POST /api/accounts/users/me/change-password/
   * body: { current_password, new_password }
   */
  async changeMyPassword({ current_password, new_password }) {
    const { data } = await api.post("/accounts/users/me/change-password/", {
      current_password,
      new_password,
    });
    return data;
  },
};
