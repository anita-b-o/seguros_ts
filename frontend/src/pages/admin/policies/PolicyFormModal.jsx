import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { adminPoliciesApi } from "@/services/adminPoliciesApi";
import {
  clearAdminPoliciesErrors,
  createAdminPolicy,
  patchAdminPolicy,
  markAdminPolicyPaid,
} from "@/features/adminPolicies/adminPoliciesSlice";
import { api } from "@/api/http";

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtRange(a, b) {
  if (!a && !b) return "-";
  if (a && b) return `${a} → ${b}`;
  return a || b || "-";
}

function safeStr(v) {
  return v == null ? "" : String(v);
}

function pickFirst(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function addMonthsISO(startISO, months = 3) {
  if (!startISO) return "";
  const [y, m, d] = String(startISO).split("-").map(Number);
  if (!y || !m || !d) return "";

  const year = y + Math.floor((m - 1 + months) / 12);
  const month = ((m - 1 + months) % 12) + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(d, lastDay);

  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseISODate(iso) {
  if (!iso || typeof iso !== "string") return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function isWithinPaymentWindow(policy) {
  // Regla UI: habilitado si hoy <= payment_end_date
  const endISO = pickFirst(policy, ["payment_end_date"]) || null;
  const end = parseISODate(endISO);
  if (!end) return false;
  const today = parseISODate(todayISO());
  return !!today && today.getTime() <= end.getTime();
}

function isPaid(policy) {
  const bs = (policy?.billing_status || "").toUpperCase();
  return bs === "PAID";
}

async function fetchAdminUsers({ page = 1, search = "" } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (search) params.set("search", String(search).trim());

  const url = params.toString()
    ? `/admin/accounts/users/?${params.toString()}`
    : `/admin/accounts/users/`;

  const { data } = await api.get(url);
  return data;
}

export default function PolicyFormModal({ open, onClose, policy }) {
  const dispatch = useDispatch();
  const { loadingSave, loadingMarkPaid, fieldErrors, errorMarkPaid } = useSelector(
    (s) => s.adminPolicies
  );

  const isEdit = !!policy?.id;

  const [products, setProducts] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [number, setNumber] = useState("");
  const [productId, setProductId] = useState("");
  const [userId, setUserId] = useState("");
  const [premium, setPremium] = useState("");
  const [startDate, setStartDate] = useState(todayISO());

  // ✅ NUEVO: flag local “pendiente de marcar abonada al guardar”
  const [markPaidOnSave, setMarkPaidOnSave] = useState(false);

  const endDatePreview = useMemo(() => addMonthsISO(startDate, 3), [startDate]);

  const canSubmit =
    !!safeStr(number).trim() &&
    !!safeStr(premium).trim() &&
    !loadingSave &&
    !loadingMarkPaid;

  useEffect(() => {
    if (!open) return;

    dispatch(clearAdminPoliciesErrors());

    if (isEdit) {
      setNumber(policy?.number || "");
      setProductId(String(policy?.product_id ?? ""));
      setUserId(String(policy?.user_id ?? ""));
      setPremium(policy?.premium != null ? String(policy.premium) : "");
      setStartDate(policy?.start_date || todayISO());

      // ✅ Al abrir edición: por default no marcamos nada hasta que el usuario lo tilda
      setMarkPaidOnSave(false);
      return;
    }

    setNumber("");
    setProductId("");
    setUserId("");
    setPremium("");
    setStartDate(todayISO());
    setMarkPaidOnSave(false);

    (async () => {
      setLoadingProducts(true);
      setLoadingUsers(true);
      try {
        const [prod, users] = await Promise.allSettled([
          adminPoliciesApi.listInsuranceTypes({ page: 1 }),
          fetchAdminUsers({ page: 1 }),
        ]);
        if (prod.status === "fulfilled") setProducts(prod.value?.results || []);
        if (users.status === "fulfilled") setUsers(users.value?.results || []);
      } finally {
        setLoadingProducts(false);
        setLoadingUsers(false);
      }
    })();
  }, [open, isEdit, policy, dispatch]);

  if (!open) return null;

  const getFieldErr = (k) => {
    const v = fieldErrors?.[k];
    if (!v) return "";
    return Array.isArray(v) ? v.join(" ") : String(v);
  };

  // -------------------------
  // Info extra (solo lectura)
  // -------------------------
  const vigRange = fmtRange(policy?.start_date, policy?.end_date);
  const payRange = fmtRange(policy?.payment_start_date, policy?.payment_end_date);
  const dueVisible = pickFirst(policy, ["client_end_date"]) || "-";
  const dueReal = pickFirst(policy, ["real_end_date"]) || policy?.payment_end_date || "-";
  const adjRange = fmtRange(policy?.adjustment_from, policy?.adjustment_to);

  const paid = isPaid(policy);
  const inPayWindow = isWithinPaymentWindow(policy);

  // ✅ Permitimos “tildar” solo si se puede realmente ejecutar en backend
  const canToggleMarkPaid = isEdit && !paid && inPayWindow && !loadingSave && !loadingMarkPaid;

  const markPaidHint = !isEdit
    ? ""
    : paid
      ? "La póliza ya figura como pagada."
      : !inPayWindow
        ? "Fuera del período de pago."
        : "Se aplicará al tocar Guardar.";

  const onSubmit = async (e) => {
    e.preventDefault();
    dispatch(clearAdminPoliciesErrors());

    if (isEdit) {
      const payload = {
        number: number.trim(),
        premium: String(premium),
      };

      if (safeStr(startDate).trim()) payload.start_date = startDate;
      if (safeStr(userId).trim()) payload.user_id = Number(userId);

      // 1) Guardar cambios primero
      const resSave = await dispatch(patchAdminPolicy({ id: policy.id, payload }));
      if (resSave.meta.requestStatus !== "fulfilled") return;

      // 2) Si el usuario tildó “marcar abonada”, recién acá lo hacemos efectivo
      if (markPaidOnSave) {
        const resPaid = await dispatch(markAdminPolicyPaid(policy.id));
        if (resPaid.meta.requestStatus !== "fulfilled") {
          // no cerramos; se verá errorMarkPaid
          return;
        }
      }

      // 3) Cerrar modal solo si todo salió bien (save y opcional markPaid)
      onClose?.();
      return;
    }

    // CREATE (sin marcar abonada, aplica solo a edición)
    const payload = {
      number: number.trim(),
      premium: String(premium),
    };

    if (safeStr(productId).trim()) payload.product_id = Number(productId);
    if (safeStr(userId).trim()) payload.user_id = Number(userId);
    if (safeStr(startDate).trim()) payload.start_date = startDate;

    const res = await dispatch(createAdminPolicy(payload));
    if (res.meta.requestStatus === "fulfilled") {
      onClose?.();
      setNumber("");
      setProductId("");
      setUserId("");
      setPremium("");
      setStartDate(todayISO());
      setMarkPaidOnSave(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{isEdit ? "Editar póliza" : "Crear póliza"}</div>
            {isEdit ? (
              <div className="modal-sub">
                Vigencia: <strong>{vigRange}</strong>
              </div>
            ) : null}
          </div>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* ✅ INFO EXTRA SOLO EN EDICIÓN */}
        {isEdit ? (
          <div className="table-card" style={{ padding: 12, marginBottom: 12 }}>
            <div className="table-head" style={{ marginBottom: 10 }}>
              <div className="table-title">Información extra</div>
              <div className="table-muted">Datos calculados (solo lectura)</div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <div>
                <div className="info-k">Vigencia</div>
                <div className="info-v mono">{vigRange}</div>
              </div>

              <div>
                <div className="info-k">Período pago</div>
                <div className="info-v mono">{payRange}</div>
              </div>

              <div>
                <div className="info-k">Vence (visible)</div>
                <div className="info-v mono">{dueVisible}</div>
              </div>

              <div>
                <div className="info-k">Vence (real)</div>
                <div className="info-v mono">{dueReal}</div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div className="info-k">Ajuste</div>
                <div className="info-v mono">{adjRange}</div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div className="info-k">Estado de cobro</div>
                <div className="info-v">
                  <span className="mono">{paid ? "PAID" : safeStr(policy?.billing_status || "UNPAID")}</span>
                  {" · "}
                  <span className="mono">{inPayWindow ? "Dentro de período" : "Fuera de período"}</span>
                </div>

                {errorMarkPaid ? (
                  <div className="field-err" style={{ marginTop: 6 }}>
                    {typeof errorMarkPaid === "string"
                      ? errorMarkPaid
                      : safeStr(errorMarkPaid?.detail || "No se pudo marcar como abonada")}
                  </div>
                ) : null}
              </div>

              {/* ✅ NUEVO: toggle local (NO ejecuta nada hasta Guardar) */}
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: canToggleMarkPaid ? "pointer" : "not-allowed" }}>
                  <input
                    type="checkbox"
                    checked={markPaidOnSave}
                    onChange={(e) => setMarkPaidOnSave(e.target.checked)}
                    disabled={!canToggleMarkPaid}
                  />
                  <span>
                    Marcar como abonada <span className="table-muted">(al guardar)</span>
                  </span>
                </label>

                <div className="table-muted" style={{ marginTop: 6 }}>
                  {markPaidOnSave ? "Se aplicará al tocar Guardar." : markPaidHint}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <form className="form" onSubmit={onSubmit}>
          <label className="form-label">
            Número de póliza *
            <input
              className={`form-input ${getFieldErr("number") ? "is-invalid" : ""}`}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="SC-1234"
              required
            />
            {getFieldErr("number") && <div className="field-err">{getFieldErr("number")}</div>}
          </label>

          <label className="form-label">
            Premium *
            <input
              className={`form-input ${getFieldErr("premium") ? "is-invalid" : ""}`}
              value={premium}
              onChange={(e) => setPremium(e.target.value)}
              required
            />
            {getFieldErr("premium") && <div className="field-err">{getFieldErr("premium")}</div>}
          </label>

          {!isEdit && (
            <>
              <label className="form-label">
                Fecha inicio
                <input
                  type="date"
                  className="form-input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>

              <label className="form-label">
                Fecha fin (calculada)
                <input className="form-input" value={endDatePreview} disabled />
              </label>
            </>
          )}

          <label className="form-label">
            Cliente
            <select
              className="form-input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={loadingUsers}
            >
              <option value="">Sin cliente</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                </option>
              ))}
            </select>
          </label>

          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" type="submit" disabled={!canSubmit}>
              {loadingSave || loadingMarkPaid
                ? "Guardando…"
                : isEdit
                  ? "Guardar"
                  : "Crear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
