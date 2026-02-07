import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { adminPoliciesApi } from "@/services/adminPoliciesApi";
import { quotesApi } from "@/services/quotesApi";
import {
  clearAdminPoliciesErrors,
  createAdminPolicy,
  patchAdminPolicy,
  markAdminPolicyPaid,
  fetchAdminPolicies,
} from "@/features/adminPolicies/adminPoliciesSlice";
import { api } from "@/api/http";
import { useToast } from "@/contexts/ToastContext";

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

function normalizeAmountInput(raw) {
  const value = safeStr(raw).trim();
  if (!value) return null;
  const cleaned = value.replace(/\s/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(/,/g, ".");
  } else if (hasComma) {
    normalized = cleaned.replace(/,/g, ".");
  }
  normalized = normalized.replace(/[^0-9.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return { normalized, number: num };
}

function pickFirst(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function parseISODate(iso) {
  if (!iso || typeof iso !== "string") return null;
  const raw = iso.trim();
  const datePart = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/**
 * ✅ PAID helper (evita ReferenceError)
 */
function isPaid(policy) {
  if (policy?.is_paid === true || policy?.paid === true) return true;
  const bs = String(policy?.billing_status || policy?.payment_status || "").toUpperCase();
  return ["PAID", "PAGADO", "APPROVED", "APROBADO"].includes(bs);
}

/**
 * ✅ Ventana de pago INCLUSIVA:
 * - hoy >= payment_start_date
 * - hoy <= payment_end_date  (incluye el día de vencimiento)
 */
function isWithinPaymentWindow(policy) {
  const startISO = pickFirst(policy, ["payment_start_date"]) || null;
  const endISO = pickFirst(policy, ["payment_end_date"]) || null;

  const start = parseISODate(startISO);
  const end = parseISODate(endISO);

  // Si falta cualquiera de las dos fechas, no habilitamos
  if (!start || !end) return false;

  const today = parseISODate(todayISO());
  if (!today) return false;

  // ✅ Inclusive: permite cobrar en start_date, en end_date, y entre medio
  return today.getTime() >= start.getTime() && today.getTime() <= end.getTime();
}

function clientLabel(u) {
  const name =
    [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() ||
    u?.full_name ||
    u?.username ||
    "";
  const email = u?.email ? String(u.email) : "";
  const base = name || email || `Usuario #${u?.id}`;
  return email && name ? `${base} — ${email}` : base;
}

function getPolicyUserId(policy) {
  const id = policy?.user_id ?? policy?.user_obj?.id ?? policy?.user?.id ?? null;
  return id != null ? String(id) : "";
}

/**
 * ✅ Traer usuarios clientes
 * - Soporta DRF paginado ({results}) o lista simple
 * - Filtra fuera staff/superuser para que el select muestre "clientes"
 */
async function fetchAdminUsers({ page = 1, search = "" } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (search) params.set("search", String(search).trim());

  const url = params.toString()
    ? `/admin/accounts/users/?${params.toString()}`
    : `/admin/accounts/users/`;

  const { data } = await api.get(url);

  const raw = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data)
      ? data
      : [];
  // filtro defensivo: no mostrar staff/superuser en "Cliente"
  const filtered = raw.filter((u) => !u?.is_staff && !u?.is_superuser);

  return {
    raw: filtered,
    total: (() => {
      const rawCount = Number(data?.count ?? 0);
      if (!rawCount) return Number(filtered.length || 0);
      const removed = raw.length - filtered.length;
      return Math.max(0, rawCount - Math.max(0, removed));
    })(),
    next: data?.next ?? null,
    previous: data?.previous ?? null,
  };
}

export default function PolicyFormModal({ open, onClose, policy }) {
  const dispatch = useDispatch();
  const { pushToast } = useToast();
  const { loadingSave, loadingMarkPaid, fieldErrors, errorMarkPaid, page } = useSelector(
    (s) => s.adminPolicies
  );

  const isEdit = !!policy?.id;

  const [products, setProducts] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersQuery, setUsersQuery] = useState("");
  const [usersNext, setUsersNext] = useState(false);
  const [usersPrev, setUsersPrev] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersErr, setUsersErr] = useState("");
  const usersSearchTimer = useRef(null);
  const usersRequestId = useRef(0);

  const [number, setNumber] = useState("");
  const [productId, setProductId] = useState("");
  const [userId, setUserId] = useState("");
  const [premium, setPremium] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [status, setStatus] = useState("active");
  const [originalStatus, setOriginalStatus] = useState("");
  const [reactivateConfirmOpen, setReactivateConfirmOpen] = useState(false);
  const [reactivateConfirmBusy, setReactivateConfirmBusy] = useState(false);
  const [markPaidConfirmOpen, setMarkPaidConfirmOpen] = useState(false);

  const [quoteLink, setQuoteLink] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [showVehicleExtras, setShowVehicleExtras] = useState(false);

  const [vehicle, setVehicle] = useState({
    plate: "",
    make: "",
    model: "",
    year: "",
    version: "",
    city: "",
    usage: "",
    has_garage: false,
    is_zero_km: false,
    has_gnc: false,
    gnc_amount: "",
  });
  const [vehicleError, setVehicleError] = useState("");

  const canSubmit =
    !!safeStr(number).trim() &&
    !!safeStr(premium).trim() &&
    !loadingSave &&
    !loadingMarkPaid;

  const loadUsers = async ({ page = usersPage, search = usersQuery } = {}) => {
    const requestId = ++usersRequestId.current;
    setLoadingUsers(true);
    setUsersErr("");
    try {
      let targetPage = page;
      let res = await fetchAdminUsers({ page: targetPage, search });
      if (usersRequestId.current !== requestId) return;
      let safety = 0;
      while ((res.raw || []).length === 0 && res.next && safety < 5) {
        targetPage += 1;
        safety += 1;
        res = await fetchAdminUsers({ page: targetPage, search });
        if (usersRequestId.current !== requestId) return;
      }
      setUsers(res.raw || []);
      setUsersTotal(Number(res.total || 0));
      setUsersPage(targetPage);
      setUsersNext(Boolean(res.next));
      setUsersPrev(Boolean(res.previous) || page > 1);
      if ((res.raw || []).length === 0) {
        setUsersErr("");
      }
    } catch {
      if (usersRequestId.current !== requestId) return;
      setUsers([]);
      setUsersTotal(0);
      setUsersNext(false);
      setUsersPrev(false);
      setUsersErr("No se pudieron cargar los clientes.");
    } finally {
      if (usersRequestId.current !== requestId) return;
      setLoadingUsers(false);
    }
  };

  // ✅ Cargar productos + usuarios al abrir SIEMPRE (crear y editar)
  useEffect(() => {
    if (!open) return;

    dispatch(clearAdminPoliciesErrors());
    setUsersErr("");
    if (usersSearchTimer.current) {
      clearTimeout(usersSearchTimer.current);
      usersSearchTimer.current = null;
    }
    usersRequestId.current += 1;

    if (isEdit) {
      setNumber(policy?.number || "");
      setProductId(String(policy?.product_id ?? ""));
      setUserId(getPolicyUserId(policy)); // ✅ robusto: user_id / user.id / user_obj.id
      setPremium(policy?.premium != null ? String(policy.premium) : "");
      setStartDate(policy?.start_date || todayISO());
      setStatus(policy?.status || "active");
      setOriginalStatus(policy?.status || "");
      setQuoteLink("");
      setQuoteError("");
      setVehicleError("");
    } else {
      setNumber("");
      setProductId("");
      setUserId("");
      setPremium("");
      setStartDate(todayISO());
      setStatus("active");
      setOriginalStatus("");
      setQuoteLink("");
      setQuoteError("");
      setVehicleError("");
      setShowVehicleExtras(false);
      setVehicle({
        plate: "",
        make: "",
        model: "",
        year: "",
        version: "",
        city: "",
        usage: "",
        has_garage: false,
        is_zero_km: false,
        has_gnc: false,
        gnc_amount: "",
      });
    }

    let alive = true;

    (async () => {
      setLoadingProducts(true);
      try {
        const prodRes = await adminPoliciesApi.listInsuranceTypes({ page: 1 });
        if (!alive) return;
        setProducts(prodRes?.results || []);
      } catch {
        if (!alive) return;
        setProducts([]);
      } finally {
        if (!alive) return;
        setLoadingProducts(false);
      }
    })();

    setUsersPage(1);
    setUsersQuery("");
    void loadUsers({ page: 1, search: "" });

    return () => {
      alive = false;
      if (usersSearchTimer.current) {
        clearTimeout(usersSearchTimer.current);
        usersSearchTimer.current = null;
      }
      usersRequestId.current += 1;
    };
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
  const canToggleMarkPaid =
    isEdit && !paid && inPayWindow && !loadingSave && !loadingMarkPaid;

  const markPaidHint = !isEdit
    ? ""
    : paid
      ? "La póliza ya figura como pagada."
      : !inPayWindow
        ? "Fuera del período de pago."
        : "";

  const onMarkPaidNow = async () => {
    if (!isEdit || !canToggleMarkPaid) return;
    setMarkPaidConfirmOpen(true);
  };

  // ✅ Si el userId actual no está en el listado (filtros/paginación),
  // agregamos una opción “Cliente actual” para que el select muestre el valor.
  const selectedMissing =
    safeStr(userId).trim() && !users.some((u) => String(u.id) === String(userId));

  const performEditSave = async () => {
    const prevStatus = originalStatus || policy?.status || "";
    const nextStatus = status;
    const activating =
      ["expired", "suspended", "cancelled"].includes(prevStatus) &&
      nextStatus === "active";

    const premiumInfo = normalizeAmountInput(premium);
    if (!premiumInfo) {
      pushToast({ type: "error", message: "El monto debe ser un número válido." });
      return;
    }

    if (activating && !reactivateConfirmOpen) {
      setReactivateConfirmOpen(true);
      return;
    }

    const payload = {
      number: number.trim(),
      premium: premiumInfo.normalized,
    };

    if (activating) {
      payload.start_date = todayISO();
    } else if (safeStr(startDate).trim()) {
      payload.start_date = startDate;
    }
    if (safeStr(status).trim()) payload.status = status;

    // ✅ permitir desasignar cliente: si userId === "" mandamos null
    payload.user_id = safeStr(userId).trim() ? Number(userId) : null;

    // 1) Guardar cambios primero
    const resSave = await dispatch(patchAdminPolicy({ id: policy.id, payload }));
    if (resSave.meta.requestStatus !== "fulfilled") return;

    await dispatch(fetchAdminPolicies({ page }));

    // 3) Cerrar modal solo si todo salió bien
    onClose?.();
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    dispatch(clearAdminPoliciesErrors());
    setVehicleError("");

    if (isEdit) {
      await performEditSave();
      return;
    }

    const premiumInfo = normalizeAmountInput(premium);
    if (!premiumInfo) {
      pushToast({ type: "error", message: "El monto debe ser un número válido." });
      return;
    }

    // CREATE
    const payload = {
      number: number.trim(),
      premium: premiumInfo.normalized,
    };

    if (safeStr(productId).trim()) payload.product_id = Number(productId);

    // ✅ permitir crear sin cliente: si vacío no mandamos user_id
    if (safeStr(userId).trim()) payload.user_id = Number(userId);

    if (safeStr(startDate).trim()) payload.start_date = startDate;

    const hasVehicleInput = Object.values(vehicle).some((val) => {
      if (typeof val === "boolean") return val;
      return safeStr(val).trim();
    });

    if (hasVehicleInput) {
      const missing = ["plate", "make", "model", "year"].filter(
        (key) => !safeStr(vehicle[key]).trim()
      );
      if (missing.length) {
        setVehicleError("Para adjuntar el vehículo, completá patente, marca, modelo y año.");
        return;
      } else {
        setVehicleError("");
        const yearNum = Number(vehicle.year);
        if (!Number.isFinite(yearNum)) {
          setVehicleError("El año del vehículo debe ser un número válido.");
          return;
        }

        const payloadVehicle = {
          plate: safeStr(vehicle.plate).trim(),
          make: safeStr(vehicle.make).trim(),
          model: safeStr(vehicle.model).trim(),
          year: yearNum,
        };

        if (safeStr(vehicle.version).trim()) {
          payloadVehicle.version = safeStr(vehicle.version).trim();
        }
        if (safeStr(vehicle.city).trim()) payloadVehicle.city = safeStr(vehicle.city).trim();
        if (safeStr(vehicle.usage).trim()) payloadVehicle.usage = safeStr(vehicle.usage).trim();
        if (vehicle.has_garage) payloadVehicle.has_garage = true;
        if (vehicle.is_zero_km) payloadVehicle.is_zero_km = true;
        if (vehicle.has_gnc) payloadVehicle.has_gnc = true;
        if (safeStr(vehicle.gnc_amount).trim()) {
          const gncAmountNum = Number(vehicle.gnc_amount);
          if (!Number.isFinite(gncAmountNum)) {
            setVehicleError("El monto de GNC debe ser numérico.");
            return;
          }
          payloadVehicle.gnc_amount = gncAmountNum;
        }

        payload.vehicle = payloadVehicle;
      }
    }

    const res = await dispatch(createAdminPolicy(payload));
    if (res.meta.requestStatus === "fulfilled") {
      await dispatch(fetchAdminPolicies({ page }));
      onClose?.();
      setNumber("");
      setProductId("");
      setUserId("");
      setPremium("");
      setStartDate(todayISO());
    }
  };

  const closeReactivateConfirm = () => {
    if (reactivateConfirmBusy) return;
    setReactivateConfirmOpen(false);
  };

  const runReactivateConfirm = async () => {
    if (reactivateConfirmBusy) return;
    setReactivateConfirmBusy(true);
    setReactivateConfirmOpen(false);
    await performEditSave();
    setReactivateConfirmBusy(false);
  };

  const closeMarkPaidConfirm = () => {
    if (loadingMarkPaid) return;
    setMarkPaidConfirmOpen(false);
  };

  const runMarkPaidConfirm = async () => {
    if (loadingMarkPaid) return;
    setMarkPaidConfirmOpen(false);
    const res = await dispatch(markAdminPolicyPaid({ id: policy.id }));
    if (res.meta.requestStatus === "fulfilled") {
      await dispatch(fetchAdminPolicies({ page }));
      pushToast({ type: "success", message: "Póliza marcada como abonada." });
      onClose?.();
    } else {
      pushToast({ type: "error", message: "No se pudo marcar como abonada." });
    }
  };

  const extractQuoteToken = (raw) => {
    const value = String(raw || "").trim();
    if (!value) return "";
    const match = value.match(/quote\/share\/([^/?#]+)/i);
    if (match?.[1]) return match[1];
    const matchApi = value.match(/quotes\/share\/([^/?#]+)/i);
    if (matchApi?.[1]) return matchApi[1];
    return value;
  };

  const onLoadQuote = async () => {
    setQuoteError("");
    const token = extractQuoteToken(quoteLink);
    if (!token) {
      setQuoteError("Ingresá un link o token de cotización válido.");
      return;
    }
    setQuoteLoading(true);
    try {
      const data = await quotesApi.getShare(token);
      setVehicle((prev) => ({
        ...prev,
        make: data?.make || "",
        model: data?.model || "",
        version: data?.version || "",
        year: data?.year != null ? String(data.year) : "",
        city: data?.city || "",
        usage: data?.usage || "",
        has_garage: Boolean(data?.has_garage),
        is_zero_km: Boolean(data?.is_zero_km),
        has_gnc: Boolean(data?.has_gnc),
        gnc_amount: data?.gnc_amount != null ? String(data.gnc_amount) : "",
      }));
    } catch (e) {
      setQuoteError(e?.response?.data?.detail || "No se pudo cargar la cotización.");
    } finally {
      setQuoteLoading(false);
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
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="modal-body">
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
                    <span className="mono">
                      {paid ? "PAID" : safeStr(policy?.billing_status || "UNPAID")}
                    </span>
                    {" · "}
                    <span className="mono">
                      {inPayWindow ? "Dentro de período" : "Fuera de período"}
                    </span>
                  </div>

                  {errorMarkPaid ? (
                    <div className="field-err" style={{ marginTop: 6 }}>
                      {typeof errorMarkPaid === "string"
                        ? errorMarkPaid
                        : safeStr(errorMarkPaid?.detail || "No se pudo marcar como abonada")}
                    </div>
                  ) : null}
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={onMarkPaidNow}
                    disabled={!canToggleMarkPaid}
                  >
                    Marcar como paga ahora
                  </button>
                  {markPaidHint ? (
                    <div className="table-muted" style={{ marginTop: 6 }}>
                      {markPaidHint}
                    </div>
                  ) : null}
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
              Monto *
              <input
                className={`form-input ${getFieldErr("premium") ? "is-invalid" : ""}`}
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                required
              />
              {getFieldErr("premium") && <div className="field-err">{getFieldErr("premium")}</div>}
            </label>

            {isEdit ? (
              <label className="form-label">
                Estado
                <select
                  className={`form-input ${getFieldErr("status") ? "is-invalid" : ""}`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="active">Activa</option>
                  <option value="expired">Vencida</option>
                  <option value="suspended">Suspendida</option>
                  <option value="cancelled">Cancelada</option>
                </select>
                {getFieldErr("status") && <div className="field-err">{getFieldErr("status")}</div>}
              </label>
            ) : null}

            <label className="form-label">
              Cliente
              {usersErr ? <div className="field-err">{usersErr}</div> : null}

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  className="form-input"
                  value={usersQuery}
                  onChange={(e) => {
                    const next = e.target.value;
                    setUsersQuery(next);
                    setUsersPage(1);
                    if (usersSearchTimer.current) {
                      clearTimeout(usersSearchTimer.current);
                    }
                    usersSearchTimer.current = setTimeout(() => {
                      usersSearchTimer.current = null;
                      void loadUsers({ page: 1, search: next });
                    }, 300);
                  }}
                  placeholder="Buscar cliente por nombre o email…"
                  disabled={loadingUsers}
                />
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => loadUsers({ page: 1, search: usersQuery })}
                  disabled={loadingUsers}
                >
                  {loadingUsers ? "Buscando…" : "Buscar"}
                </button>
              </div>

              <select
                className={`form-input ${getFieldErr("user_id") ? "is-invalid" : ""}`}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={loadingUsers}
              >
                <option value="">
                  {loadingUsers ? "Cargando clientes…" : "Sin cliente"}
                </option>

                {selectedMissing ? (
                  <option value={userId}>Cliente actual (id #{userId})</option>
                ) : null}

                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {clientLabel(u)}
                  </option>
                ))}
              </select>

              {getFieldErr("user_id") && <div className="field-err">{getFieldErr("user_id")}</div>}

              <div
                className="table-muted"
                style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}
              >
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => loadUsers({ page: Math.max(1, usersPage - 1), search: usersQuery })}
                  disabled={loadingUsers || !usersPrev}
                >
                  Anterior
                </button>
                <span className="mono">
                  Página {usersPage}
                  {usersTotal ? ` · Total ${usersTotal}` : ""}
                </span>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => loadUsers({ page: usersPage + 1, search: usersQuery })}
                  disabled={loadingUsers || !usersNext}
                >
                  Siguiente
                </button>
              </div>
            </label>

            {!isEdit && (
              <>
                <label className="form-label">
                  Tipo de seguro
                  <select
                    className={`form-input ${getFieldErr("product_id") ? "is-invalid" : ""}`}
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    disabled={loadingProducts}
                  >
                    <option value="">
                      {loadingProducts ? "Cargando productos…" : "Seleccionar…"}
                    </option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || `Producto #${p.id}`}
                      </option>
                    ))}
                  </select>
                  {getFieldErr("product_id") && (
                    <div className="field-err">{getFieldErr("product_id")}</div>
                  )}
                </label>

                <label className="form-label">
                  Fecha inicio
                  <input
                    type="date"
                    className="form-input"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>

                <div className="form-label">
                  <button
                    className="btn-link"
                    type="button"
                    onClick={() => setShowVehicleExtras((prev) => !prev)}
                    style={{
                      marginTop: 6,
                      alignSelf: "flex-start",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontWeight: 600,
                      color: "#000",
                    }}
                  >
                    Cargar datos de vehículo
                    <span aria-hidden="true">{showVehicleExtras ? "▾" : "▸"}</span>
                  </button>
                </div>

                {showVehicleExtras ? (
                  <>
                    <div className="form-label">
                      Link de cotización
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <input
                          className="form-input"
                          value={quoteLink}
                          onChange={(e) => setQuoteLink(e.target.value)}
                          placeholder="https://.../quote/share/ABC123"
                          disabled={quoteLoading}
                        />
                        <button
                          className="btn-secondary"
                          type="button"
                          onClick={onLoadQuote}
                          disabled={quoteLoading}
                        >
                          {quoteLoading ? "Cargando…" : "Cargar"}
                        </button>
                      </div>
                      {quoteError ? <div className="field-err">{quoteError}</div> : null}
                      <div className="table-muted" style={{ marginTop: 6 }}>
                        Podés pegar el link de cotización para cargar los datos del vehiculo o ingresarlos uno a uno.
                      </div>
                    </div>

                    <div className="table-card" style={{ padding: 12 }}>
                      <div className="table-head" style={{ marginBottom: 10 }}>
                        <div className="table-title">Vehículo</div>
                      </div>

                      {vehicleError ? <div className="field-err">{vehicleError}</div> : null}

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        <label className="form-label" style={{ margin: 0 }}>
                          Patente
                          <input
                            className="form-input"
                            value={vehicle.plate}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, plate: e.target.value }))
                            }
                            placeholder="AB123CD"
                          />
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          Marca
                          <input
                            className="form-input"
                            value={vehicle.make}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, make: e.target.value }))
                            }
                            placeholder="Toyota"
                          />
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          Modelo
                          <input
                            className="form-input"
                            value={vehicle.model}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, model: e.target.value }))
                            }
                            placeholder="Corolla"
                          />
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          Año
                          <input
                            className="form-input"
                            value={vehicle.year}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, year: e.target.value }))
                            }
                            placeholder="2020"
                            inputMode="numeric"
                          />
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          Versión
                          <input
                            className="form-input"
                            value={vehicle.version}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, version: e.target.value }))
                            }
                            placeholder="1.6 XEi"
                          />
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          Ciudad
                          <input
                            className="form-input"
                            value={vehicle.city}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, city: e.target.value }))
                            }
                            placeholder="CABA"
                          />
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          Uso
                          <input
                            className="form-input"
                            value={vehicle.usage}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, usage: e.target.value }))
                            }
                            placeholder="Particular"
                          />
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          Monto GNC
                          <input
                            className="form-input"
                            value={vehicle.gnc_amount}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, gnc_amount: e.target.value }))
                            }
                            placeholder="4000"
                            inputMode="numeric"
                          />
                        </label>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 12,
                          marginTop: 10,
                        }}
                      >
                        <label className="form-label" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={vehicle.has_garage}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, has_garage: e.target.checked }))
                            }
                          />{" "}
                          Tiene garage
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={vehicle.is_zero_km}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, is_zero_km: e.target.checked }))
                            }
                          />{" "}
                          0 km
                        </label>

                        <label className="form-label" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={vehicle.has_gnc}
                            onChange={(e) =>
                              setVehicle((prev) => ({ ...prev, has_gnc: e.target.checked }))
                            }
                          />{" "}
                          Tiene GNC
                        </label>
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            )}

            <div className="modal-actions">
              <button className="btn-secondary" type="button" onClick={onClose}>
                Cancelar
              </button>
              <button className="btn-primary" type="submit" disabled={!canSubmit}>
                {loadingSave || loadingMarkPaid ? "Guardando…" : isEdit ? "Guardar" : "Crear"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {reactivateConfirmOpen ? (
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
                  Confirmar activación
                </div>
                <div className="modal-sub" style={{ fontSize: 12 }}>
                  La póliza se activará con el nuevo período iniciado hoy.
                </div>
              </div>
              <button
                className="modal-x"
                onClick={closeReactivateConfirm}
                disabled={reactivateConfirmBusy}
              >
                ✕
              </button>
            </div>

            <div className="form modal-body" style={{ padding: "14px" }}>
              <div
                className="modal-actions"
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={closeReactivateConfirm}
                  disabled={reactivateConfirmBusy}
                  style={{ padding: "6px 10px" }}
                >
                  Cancelar
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={runReactivateConfirm}
                  disabled={reactivateConfirmBusy}
                  style={{ padding: "6px 12px" }}
                >
                  Aceptar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {markPaidConfirmOpen ? (
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
                  Confirmar pago
                </div>
                <div className="modal-sub" style={{ fontSize: 12 }}>
                  {policy?.number ? `Póliza: ${policy.number}` : "Confirmación de pago manual"}
                </div>
              </div>
              <button className="modal-x" onClick={closeMarkPaidConfirm} disabled={loadingMarkPaid}>
                ✕
              </button>
            </div>

            <div className="form modal-body" style={{ padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                ¿Marcar esta póliza como abonada ahora?
              </div>

              <div className="rcpt-muted" style={{ padding: 0, fontSize: 12 }}>
                Se marcará el período vigente como abonado.
              </div>

              <div
                className="modal-actions"
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={closeMarkPaidConfirm}
                  disabled={loadingMarkPaid}
                  style={{ padding: "6px 10px" }}
                >
                  Cancelar
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={runMarkPaidConfirm}
                  disabled={loadingMarkPaid}
                  style={{ padding: "6px 12px" }}
                >
                  {loadingMarkPaid ? "Procesando…" : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
