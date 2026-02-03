// frontend/src/pages/dashboard/DashboardHome.jsx

import { useEffect, useMemo, useState } from "react";
import useAuth from "@/hooks/useAuth";
import { policiesApi } from "@/services/policiesApi";
import "@/styles/dashboard.css";

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("es-AR");
}

// helpers tolerantes por compatibilidad
function pickFirst(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function getProductName(p) {
  const product = p?.product || p?.insurance_type || p?.plan || null;
  return (
    pickFirst(product, ["name", "plan_name", "title"]) ||
    pickFirst(p, ["product_name", "plan_name"]) ||
    ""
  );
}

function normalizeDashboardResponse(payload) {
  const policies = Array.isArray(payload?.policies) ? payload.policies : [];
  const selected = payload?.selected || null;
  const billingCurrent = payload?.billing_current || null;
  const timeline = payload?.timeline || null;

  return { policies, selected, billingCurrent, timeline };
}

export default function DashboardHome() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [policies, setPolicies] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  const [selected, setSelected] = useState(null);
  const [billingCurrent, setBillingCurrent] = useState(null);
  const [timeline, setTimeline] = useState(null);

  async function loadDashboard(policyId = "") {
    setLoading(true);
    setErr("");
    try {
      const payload = await policiesApi.getMyDashboard({
        policyId: policyId ? String(policyId) : undefined,
      });

      const norm = normalizeDashboardResponse(payload);

      setPolicies(norm.policies);
      setSelected(norm.selected);
      setBillingCurrent(norm.billingCurrent);
      setTimeline(norm.timeline);

      // Mantener seleccionado coherente
      const nextSelectedId = String(
        pickFirst(norm.selected, ["id"]) || pickFirst(norm.policies?.[0], ["id"]) || ""
      );

      setSelectedId(nextSelectedId);
    } catch (e) {
      setPolicies([]);
      setSelected(null);
      setBillingCurrent(null);
      setTimeline(null);
      setSelectedId("");
      setErr("No se pudo cargar tu dashboard.");
    } finally {
      setLoading(false);
    }
  }

  // ===== Carga inicial =====
  useEffect(() => {
    loadDashboard("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Cambio de selección =====
  useEffect(() => {
    if (!selectedId) return;
    // Evitar doble request: si ya tenemos selected con ese id, no recargar.
    const currentId = selected?.id ? String(selected.id) : "";
    if (currentId && currentId === String(selectedId)) return;
    loadDashboard(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const hasMany = policies.length > 1;

  const mapStatus = (value, labels) => {
    const raw = value == null ? "" : String(value).trim();
    if (!raw) return "-";
    const key = raw.toUpperCase();
    return labels[key] || raw;
  };

  const toDayStamp = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
    }
    if (typeof value === "string") {
      const parts = value.split("-");
      if (parts.length >= 3) {
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        const d = Number(parts[2]);
        if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
          return Date.UTC(y, m - 1, d);
        }
      }
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      }
    }
    return null;
  };

  const isTodayInRange = (start, end) => {
    const todayStamp = toDayStamp(new Date());
    const startStamp = toDayStamp(start);
    const endStamp = toDayStamp(end);
    if (todayStamp == null || startStamp == null || endStamp == null) return null;
    return todayStamp >= startStamp && todayStamp <= endStamp;
  };

  const POLICY_STATUS_LABELS = {
    ACTIVE: "Vigente",
    IN_FORCE: "Vigente",
    ISSUED: "Emitida",
    PENDING: "Pendiente",
    DRAFT: "Borrador",
    SUSPENDED: "Suspendida",
    CANCELLED: "Cancelada",
    CANCELED: "Cancelada",
    EXPIRED: "Vencida",
    LAPSED: "Vencida",
    TERMINATED: "Finalizada",
  };

  const BILLING_STATUS_LABELS = {
    PAID: "Pagado",
    UNPAID: "Impago",
    PENDING: "Pendiente",
    OVERDUE: "Vencido",
    DUE: "Pendiente",
    PARTIALLY_PAID: "Parcial",
    PROCESSING: "En proceso",
    FAILED: "Fallido",
    CANCELLED: "Anulado",
    CANCELED: "Anulado",
    VOID: "Anulado",
  };

  // ===== Vista normalizada para el resumen de póliza =====
  const policyView = useMemo(() => {
    if (!selected) return null;

    const number = pickFirst(selected, ["number", "policy_number", "policyNumber"]) || "-";
    const statusRaw = pickFirst(selected, ["status", "policy_status"]) || "-";
    const status = mapStatus(statusRaw, POLICY_STATUS_LABELS);

    const start = pickFirst(selected, ["start_date", "startDate", "term_start"]);
    const end = pickFirst(selected, ["end_date", "endDate", "term_end"]);

    const vehicle = selected.vehicle || selected.policy_vehicle || selected.policyVehicle || null;

    const vehicleLabel =
      pickFirst(vehicle, ["label", "display", "name"]) ||
      [
        pickFirst(vehicle, ["brand", "make"]),
        pickFirst(vehicle, ["model"]),
        pickFirst(vehicle, ["year"]),
      ]
        .filter(Boolean)
        .join(" ") ||
      "-";

    const plate = pickFirst(vehicle, ["plate", "license_plate", "patent"]) || "-";

    const productName = getProductName(selected) || "-";

    // Timeline (soft/hard)
    const clientEnd = pickFirst(timeline, ["client_end_date"]) || pickFirst(selected, ["client_end_date"]);
    const paymentEnd =
      pickFirst(timeline, ["payment_end_date"]) ||
      pickFirst(timeline, ["real_end_date"]) ||
      pickFirst(selected, ["payment_end_date"]);

    // Billing current (si existe)
    const periodStatusRaw = pickFirst(billingCurrent, ["status", "state"]) || null;
    const periodStatus = mapStatus(periodStatusRaw, BILLING_STATUS_LABELS);

    const amount =
      pickFirst(billingCurrent, ["amount", "total", "total_amount"]) ?? null;

    // Heurística simple de “hay algo para pagar”:
    // - si existe billing_current y no está PAID, asumimos que puede haber pago pendiente.
    const isPaid = String(periodStatusRaw || "").toUpperCase() === "PAID";
    const hasBillingPeriod = Boolean(billingCurrent);
    const inWindowByTimeline = isTodayInRange(
      pickFirst(timeline, ["payment_start_date"]),
      pickFirst(timeline, ["payment_end_date"])
    );
    const inPaymentWindow =
      hasBillingPeriod && !isPaid && (inWindowByTimeline == null ? true : inWindowByTimeline);

    return {
      number,
      status,
      start,
      end,
      vehicleLabel,
      plate,
      productName,
      clientEnd,
      paymentEnd,
      inPaymentWindow,
      billingStatus: periodStatus,
      invoiceAmount: amount,
    };
  }, [selected, billingCurrent, timeline]);

  return (
    <div className="dash-page">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Mi panel</h1>
          <p className="dash-sub">
            Hola {user?.first_name || user?.name || user?.email || ""}
          </p>
        </div>

        {hasMany ? (
          <div className="dash-picker">
            <label className="dash-label" htmlFor="dash-policy-select">
              Póliza
            </label>
            <select
              id="dash-policy-select"
              className="dash-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={loading}
            >
              {policies.map((p) => {
                const num = pickFirst(p, ["number", "policy_number", "policyNumber"]) || `#${p.id}`;
                const plan = getProductName(p);
                return (
                  <option key={p.id} value={String(p.id)}>
                    {num} {plan ? `— ${plan}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        ) : null}
      </div>

      {err ? <div className="dash-alert">{err}</div> : null}

      {loading ? (
        <div className="dash-card">
          <div className="dash-muted">Cargando…</div>
        </div>
      ) : !policyView ? (
        <div className="dash-card">
          <div className="dash-muted">Todavía no tenés pólizas asociadas.</div>
        </div>
      ) : (
        <>
          {/* Resumen póliza */}
          <section className="dash-card">
            <div className="dash-card-head">
              <div>
                <div className="dash-kicker">Póliza</div>
                <h2 className="dash-h2">{policyView.number}</h2>
              </div>
              <div className="dash-badge">{policyView.status}</div>
            </div>

            <div className="dash-grid">
              <div className="dash-item">
                <div className="dash-k">Plan</div>
                <div className="dash-v">{policyView.productName}</div>
              </div>

              <div className="dash-item">
                <div className="dash-k">Vigencia</div>
                <div className="dash-v">
                  {fmtDate(policyView.start)} → {fmtDate(policyView.end)}
                </div>
              </div>

              <div className="dash-item">
                <div className="dash-k">Vehículo</div>
                <div className="dash-v">{policyView.vehicleLabel}</div>
              </div>

              <div className="dash-item">
                <div className="dash-k">Patente</div>
                <div className="dash-v mono">{policyView.plate}</div>
              </div>
            </div>
          </section>

          {/* Facturación / período de pago */}
          <section className="dash-card">
            <div className="dash-card-head">
              <div>
                <div className="dash-kicker">Facturación</div>
                <h2 className="dash-h2">Período de pago</h2>
              </div>
            </div>

            {policyView.inPaymentWindow ? (
              <div className="dash-pay">
                <div className="dash-grid">
                  <div className="dash-item">
                    <div className="dash-k">Monto</div>
                    <div className="dash-v">{fmtMoney(policyView.invoiceAmount)}</div>
                  </div>

                  <div className="dash-item">
                    <div className="dash-k">Vence (cliente)</div>
                    <div className="dash-v">{fmtDate(policyView.clientEnd)}</div>
                  </div>

                  <div className="dash-item">
                    <div className="dash-k">Estado</div>
                    <div className="dash-v">{policyView.billingStatus || "-"}</div>
                  </div>
                </div>

                <div className="dash-actions">
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => alert("Luego conectamos 'Pagar ahora' con Mercado Pago.")}
                  >
                    Pagar ahora
                  </button>

                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => alert("Luego abrimos detalle del período / factura.")}
                  >
                    Ver detalle
                  </button>
                </div>

                <div className="dash-hint">
                </div>
              </div>
            ) : (
              <div className="dash-muted">No tenés facturas pendientes en este momento.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
