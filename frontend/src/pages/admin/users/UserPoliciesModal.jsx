// src/pages/admin/users/UserPoliciesModal.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { adminUsersApi } from "@/services/adminUsersApi";
import { api } from "@/api/http";
import { fetchAdminPolicies } from "@/features/adminPolicies/adminPoliciesSlice";
import "@/styles/adminPolicies.css";

const EMPTY_CONFIRM = {
  open: false,
  mode: null, // "attach" | "detach" | null
  policyId: null,
  policyNumber: null,
};

export default function UserPoliciesModal({ open, onClose, user }) {
  const dispatch = useDispatch();
  const { page } = useSelector((s) => s.adminPolicies || { page: 1 });

  const userId = user?.id;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [associatedPolicies, setAssociatedPolicies] = useState([]);

  // ✅ detalle del usuario (para traer phone aunque el listado no lo tenga)
  const [userDetail, setUserDetail] = useState(null);
  const [loadingUser, setLoadingUser] = useState(false);

  // selector: buscar pólizas para asociar (solo unassigned)
  const [q, setQ] = useState("");
  const [pickList, setPickList] = useState([]);
  const [loadingPick, setLoadingPick] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const pickRequestId = useRef(0);
  const pickSearchTimer = useRef(null);

  // modal confirm propio
  const [confirm, setConfirm] = useState(EMPTY_CONFIRM);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // ✅ fuente de verdad: merge (evita pisar datos del listado con un detail incompleto)
  const u = useMemo(() => {
    const base = user || {};
    const detail = userDetail || {};

    // merge simple: detail pisa base, pero no borra campos que el detail no trae
    const merged = { ...base, ...detail };

    // si detail trae phone null/empty, preferimos el phone del listado si existiera
    const detailPhone =
      detail?.phone ??
      detail?.telefono ??
      detail?.phone_number ??
      detail?.phoneNumber ??
      detail?.mobile ??
      detail?.celular ??
      detail?.tel ??
      detail?.contact_phone ??
      null;

    const s = detailPhone == null ? "" : String(detailPhone).trim();
    if (!s) {
      const basePhone =
        base?.phone ??
        base?.telefono ??
        base?.phone_number ??
        base?.phoneNumber ??
        base?.mobile ??
        base?.celular ??
        base?.tel ??
        base?.contact_phone ??
        null;

      const sb = basePhone == null ? "" : String(basePhone).trim();
      if (sb) merged.phone = basePhone;
    }

    return merged;
  }, [user, userDetail]);

  const userLabel =
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.email || "-";

  const userName =
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "-";

  // ✅ Teléfono: contempla varios nombres posibles
  const userPhone = useMemo(() => {
    const v =
      u?.phone ??
      u?.telefono ??
      u?.phone_number ??
      u?.phoneNumber ??
      u?.mobile ??
      u?.celular ??
      u?.tel ??
      u?.contact_phone ??
      null;

    const s = v == null ? "" : String(v).trim();
    return s ? s : "-";
  }, [
    u?.phone,
    u?.telefono,
    u?.phone_number,
    u?.phoneNumber,
    u?.mobile,
    u?.celular,
    u?.tel,
    u?.contact_phone,
  ]);

  // =========================
  // Reset confirm cuando corresponde
  // =========================
  useEffect(() => {
    if (!open) {
      setConfirm(EMPTY_CONFIRM);
      setConfirmBusy(false);
      return;
    }
    setConfirm(EMPTY_CONFIRM);
    setConfirmBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    // si cambia el usuario, no mantener confirm viejo
    setConfirm(EMPTY_CONFIRM);
    setConfirmBusy(false);

    // ✅ también limpiamos detalle para evitar mostrar datos del usuario anterior 1 frame
    setUserDetail(null);
    setLoadingUser(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleClose = () => {
    setConfirm(EMPTY_CONFIRM);
    setConfirmBusy(false);
    onClose?.();
  };

  // =========================
  // ✅ cargar detalle de usuario (trae phone si el listado no lo trae)
  // =========================
  const loadUserDetail = async () => {
    if (!userId) return;
    setLoadingUser(true);
    try {
      // GET /api/admin/accounts/users/:id/
      const resp = await adminUsersApi.get(userId);

      // ✅ soporta: resp = data directo OR axios resp con .data
      const payload = resp?.data ?? resp;

      setUserDetail(payload || null);
    } catch {
      // si falla, no rompemos el modal: seguimos con `user` del listado
      setUserDetail(null);
      // opcional:
      // setErr("No se pudo cargar el detalle del usuario.");
    } finally {
      setLoadingUser(false);
    }
  };

  // =========================
  // Normalizador (asociadas)
  // =========================
  const normalizeAssociated = (rawList) => {
    if (!Array.isArray(rawList)) return [];
    return rawList
      .map((x) => {
        const pol = x?.policy ?? x?.poliza ?? x;
        const id = x?.policy_id ?? pol?.id ?? x?.id;
        const number = x?.policy_number ?? pol?.number ?? x?.number;

        if (id == null && (number == null || String(number).trim() === ""))
          return null;
        return { id, number };
      })
      .filter(Boolean);
  };

  const loadAssociated = async () => {
    if (!userId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await adminUsersApi.listPolicies(userId);

      const raw = Array.isArray(data)
        ? data
        : Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.policies)
        ? data.policies
        : [];

      setAssociatedPolicies(normalizeAssociated(raw));
    } catch {
      setAssociatedPolicies([]);
      setErr("No se pudieron cargar las pólizas del usuario.");
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // Unassigned (para selector)
  // =========================
  const fetchUnassignedPolicies = async (query) => {
    const requestId = ++pickRequestId.current;
    setLoadingPick(true);
    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("page_size", "50");
      if (query) params.set("q", query);
      params.set("only_unassigned", "1");

      const { data } = await api.get(
        `/admin/policies/policies/?${params.toString()}`
      );

      const items = (data?.results || []).map((p) => ({
        id: p.id,
        number: p.number,
      }));

      if (pickRequestId.current !== requestId) return;
      setPickList(items);

      if (
        items.length === 0 ||
        !items.some((x) => String(x.id) === String(selectedPolicyId))
      ) {
        setSelectedPolicyId("");
      }
    } catch {
      if (pickRequestId.current !== requestId) return;
      setPickList([]);
      setSelectedPolicyId("");
    } finally {
      if (pickRequestId.current !== requestId) return;
      setLoadingPick(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadUserDetail();
    void loadAssociated();
    void fetchUnassignedPolicies(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  // debounce para buscar unassigned mientras tipeás
  useEffect(() => {
    if (!open) return;
    if (pickSearchTimer.current) {
      clearTimeout(pickSearchTimer.current);
    }
    pickSearchTimer.current = setTimeout(() => {
      pickSearchTimer.current = null;
      void fetchUnassignedPolicies(q);
    }, 350);
    return () => {
      if (pickSearchTimer.current) {
        clearTimeout(pickSearchTimer.current);
        pickSearchTimer.current = null;
      }
      pickRequestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  // =========================
  // Confirm modal helpers
  // =========================
  const openConfirmAttach = () => {
    const policyId = selectedPolicyId;
    if (!policyId) return;
    const picked = pickList.find((x) => String(x.id) === String(policyId));
    setConfirm({
      open: true,
      mode: "attach",
      policyId,
      policyNumber: picked?.number ?? null,
    });
  };

  const openConfirmDetach = (policyId, policyNumber) => {
    if (!policyId) return;
    setConfirm({
      open: true,
      mode: "detach",
      policyId,
      policyNumber: policyNumber ?? null,
    });
  };

  const closeConfirm = () => {
    if (confirmBusy) return;
    setConfirm(EMPTY_CONFIRM);
  };

  const runConfirmedAction = async () => {
    if (!confirm?.open || !confirm?.mode || !confirm?.policyId) return;

    setErr("");
    setConfirmBusy(true);

    try {
      if (confirm.mode === "attach") {
        await adminUsersApi.attachPolicy(userId, confirm.policyId);
        setSelectedPolicyId("");
      } else if (confirm.mode === "detach") {
        await adminUsersApi.detachPolicy(userId, confirm.policyId);
      }

      await loadAssociated();
      await fetchUnassignedPolicies(q);
      dispatch(fetchAdminPolicies({ page }));

      setConfirm(EMPTY_CONFIRM);
    } catch {
      setErr(
        confirm.mode === "attach"
          ? "No se pudo asociar la póliza."
          : "No se pudo desasociar la póliza."
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  // ✅ IMPORTANTE: return temprano al final (evita error de hooks)
  if (!open) return null;

  const confirmTitle =
    confirm.mode === "attach"
      ? "Confirmar asociación"
      : "Confirmar desasociación";

  const confirmQuestion =
    confirm.mode === "attach"
      ? "¿Asociar esta póliza al usuario?"
      : "¿Desasociar esta póliza del usuario?";

  const confirmMeta = confirm.policyNumber
    ? `Póliza: ${confirm.policyNumber}`
    : confirm.policyId
    ? `Póliza ID: ${confirm.policyId}`
    : "";

  return (
    <div className="modal-backdrop" onMouseDown={handleClose}>
      <div className="modal modal-sm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Pólizas del usuario</div>
            <div className="modal-sub">{userLabel}</div>
          </div>
          <button className="modal-x" onClick={handleClose}>
            ✕
          </button>
        </div>

        <div className="form modal-body">
          {err ? <div className="admin-alert">{String(err)}</div> : null}

          {/* Datos del usuario */}
          <div className="info-box info-box--rows">
            <div className="info-row">
              <div className="info-k">Email</div>
              <div className="info-v mono">{u?.email || "-"}</div>
            </div>

            <div className="info-row">
              <div className="info-k">Nombre y apellido</div>
              <div className="info-v">{userName}</div>
            </div>

            <div className="info-row">
              <div className="info-k">DNI</div>
              <div className="info-v mono">{u?.dni || "-"}</div>
            </div>

            <div className="info-row">
              <div className="info-k">Teléfono</div>
              <div className="info-v mono">
                {loadingUser ? "Cargando…" : userPhone}
              </div>
            </div>
          </div>

          {/* Pólizas asociadas */}
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                padding: "2px 2px 8px",
              }}
            >
              <div style={{ fontWeight: 800 }}>Pólizas asociadas</div>
              <div className="table-muted" style={{ margin: 0 }}>
                {loading ? "Cargando…" : `${associatedPolicies.length} ítems`}
              </div>
            </div>

            <div className="table-wrap-compact" style={{ borderRadius: 12 }}>
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
                  ) : associatedPolicies.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="td-muted">
                        Sin pólizas asociadas.
                      </td>
                    </tr>
                  ) : (
                    associatedPolicies.map((p) => (
                      <tr key={String(p.id ?? p.number)}>
                        <td className="mono">{p.number ?? "-"}</td>
                        <td className="td-action">
                          <button
                            className="btn-link danger"
                            type="button"
                            onClick={() => openConfirmDetach(p.id, p.number)}
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

          {/* Selector: agregar póliza (solo unassigned) */}
          <div className="info-subbox">
            <div className="form-label" style={{ marginBottom: 6 }}>
              Agregar póliza al usuario
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                className="form-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar pólizas sin asignar (ej: SC-000067)"
              />

              <select
                className="form-input"
                style={{ minWidth: 220 }}
                value={selectedPolicyId}
                onChange={(e) => setSelectedPolicyId(e.target.value)}
                disabled={loadingPick}
              >
                <option value="">
                  {loadingPick ? "Cargando…" : "Seleccioná una póliza"}
                </option>
                {pickList.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.number}
                  </option>
                ))}
              </select>

              <button
                className="btn-primary"
                type="button"
                onClick={openConfirmAttach}
                disabled={loadingPick || !selectedPolicyId}
                title={!selectedPolicyId ? "Seleccioná una póliza" : "Asociar"}
              >
                Asociar
              </button>
            </div>

            <div className="rcpt-muted" style={{ padding: "10px 0 0" }}>
              {loadingPick
                ? "Buscando pólizas sin usuario asociado…"
                : pickList.length === 0
                ? "No hay pólizas disponibles para asociar (sin usuario)."
                : `${pickList.length} póliza(s) disponible(s) para asociar.`}
            </div>
          </div>

          <div className="modal-actions">
            <button
              className="btn-secondary"
              type="button"
              onClick={handleClose}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      {/* Modal de confirmación */}
      {confirm.open ? (
        <div
          className="modal-backdrop"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="modal"
            style={{ maxWidth: 360, width: "100%", padding: 0 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ padding: "12px 14px" }}>
              <div>
                <div className="modal-title" style={{ fontSize: 15 }}>
                  {confirmTitle}
                </div>
                <div className="modal-sub" style={{ fontSize: 12 }}>
                  {userLabel}
                </div>
              </div>
              <button
                className="modal-x"
                onClick={closeConfirm}
                disabled={confirmBusy}
              >
                ✕
              </button>
            </div>

            <div className="form modal-body" style={{ padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                {confirmQuestion}
              </div>

              {confirmMeta ? (
                <div className="rcpt-muted" style={{ padding: 0, fontSize: 12 }}>
                  {confirmMeta}
                </div>
              ) : null}

              <div
                className="modal-actions"
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={closeConfirm}
                  disabled={confirmBusy}
                  style={{ padding: "6px 10px" }}
                >
                  Cancelar
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={runConfirmedAction}
                  disabled={confirmBusy}
                  style={{ padding: "6px 12px" }}
                >
                  {confirmBusy ? "Procesando…" : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
