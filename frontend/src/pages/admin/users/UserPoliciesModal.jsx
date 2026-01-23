// src/pages/admin/users/UserPoliciesModal.jsx
import { useEffect, useState } from "react";
import { adminUsersApi } from "@/services/adminUsersApi";
import { api } from "@/api/http";
import "@/styles/adminPolicies.css";

export default function UserPoliciesModal({ open, onClose, user }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [policies, setPolicies] = useState([]);

  // selector: buscar pólizas para asociar
  const [q, setQ] = useState("");
  const [pickList, setPickList] = useState([]);
  const [loadingPick, setLoadingPick] = useState(false);

  const userId = user?.id;

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await adminUsersApi.listPolicies(userId);
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.results)
        ? data.results
        : [];
      setPolicies(items);
    } catch (e) {
      setPolicies([]);
      setErr("No se pudieron cargar las pólizas del usuario.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  const searchPoliciesToAttach = async () => {
    setLoadingPick(true);
    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("page_size", "20");
      if (q) params.set("q", q);

      const { data } = await api.get(`/admin/policies/policies/?${params.toString()}`);
      const items = (data?.results || []).map((p) => ({
        id: p.id,
        number: p.number,
      }));
      setPickList(items);
    } catch {
      setPickList([]);
    } finally {
      setLoadingPick(false);
    }
  };

  const onAttach = async (policyId) => {
    if (!policyId) return;
    const ok = window.confirm("¿Asociar esta póliza al usuario?");
    if (!ok) return;

    setErr("");
    try {
      await adminUsersApi.attachPolicy(userId, policyId);
      await load();
    } catch {
      setErr("No se pudo asociar la póliza.");
    }
  };

  const onDetach = async (policyId) => {
    const ok = window.confirm("¿Desasociar esta póliza del usuario?");
    if (!ok) return;

    setErr("");
    try {
      await adminUsersApi.detachPolicy(userId, policyId);
      await load();
    } catch {
      setErr("No se pudo desasociar la póliza.");
    }
  };

  if (!open) return null;

  const userLabel =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.email || "-";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-sm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Pólizas del usuario</div>
            <div className="modal-sub">{userLabel}</div>
          </div>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Importante: el body del modal NO debe scrollear horizontal */}
        <div className="form modal-body">
          {err ? <div className="admin-alert">{String(err)}</div> : null}

          <div className="info-box">
            <div className="info-item">
              <div className="info-k">Email</div>
              <div className="info-v mono">{user?.email || "-"}</div>
            </div>
          </div>

          {/* =========================
              Tabla: Asociadas
             ========================= */}
          <div className="table-card">
            <div className="table-head">
              <div className="table-title">Asociadas</div>
              <div className="table-muted">
                {loading ? "Cargando…" : `${policies.length} ítems`}
              </div>
            </div>

            {/* OJO: para tablas compactas del modal, NO uses .table-wrap (overflow-x) */}
            <div className="table-wrap-compact">
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th className="th-action">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={2} className="td-muted">
                        Cargando…
                      </td>
                    </tr>
                  ) : policies.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="td-muted">
                        Sin pólizas asociadas.
                      </td>
                    </tr>
                  ) : (
                    policies.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.number || "-"}</td>
                        <td className="td-action">
                          <button
                            className="btn-link danger"
                            type="button"
                            onClick={() => onDetach(p.id)}
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* =========================
              Buscar / Asociar
             ========================= */}
          <div className="info-subbox">
            <div className="form-label" style={{ gap: 6 }}>
              Buscar pólizas para asociar
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  className="form-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ej: SC-000067"
                />
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={searchPoliciesToAttach}
                  disabled={loadingPick}
                >
                  {loadingPick ? "Buscando…" : "Buscar"}
                </button>
              </div>
            </div>

            <div className="table-card" style={{ marginTop: 10 }}>
              <div className="table-wrap-compact">
                <table className="table-compact">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th className="th-action">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingPick ? (
                      <tr>
                        <td colSpan={2} className="td-muted">
                          Buscando…
                        </td>
                      </tr>
                    ) : pickList.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="td-muted">
                          Sin resultados.
                        </td>
                      </tr>
                    ) : (
                      pickList.map((p) => (
                        <tr key={p.id}>
                          <td className="mono">{p.number}</td>
                          <td className="td-action">
                            <button
                              className="btn-link"
                              type="button"
                              onClick={() => onAttach(p.id)}
                            >
                              Asociar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
