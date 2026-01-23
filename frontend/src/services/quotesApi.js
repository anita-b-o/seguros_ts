import { apiPublic } from "@/api/http";

/**
 * Esperado: POST /api/quotes/share
 * Recibe multipart con campos + fotos
 * Devuelve: { token, url } o { token }
 */
export const quotesApi = {
  async createShare(formData) {
    const res = await apiPublic.post("/quotes/share", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  },
};
