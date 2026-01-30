import { api } from "@/api/http";

export const accountApi = {
  async getMe() {
    const { data } = await api.get("/accounts/users/me/");
    return data;
  },

  /**
   * Actualiza datos del usuario autenticado
   * Backend:
   * PATCH /api/accounts/users/me/
   *
   * Importante (por tu serializer actual):
   * - Usuario cliente: puede editar first_name, last_name, phone, birth_date
   * - NO puede editar email (solo admin)
   */
  async updateMe(patch) {
    const { data } = await api.patch("/accounts/users/me/", patch || {});
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
