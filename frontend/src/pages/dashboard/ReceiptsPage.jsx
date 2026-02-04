// src/pages/dashboard/ReceiptsPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
  fetchClientPolicies,
  fetchReceiptsByPolicyPage,
  fetchBillingCurrentByPolicy,
} from "@/features/receipts/receiptsSlice";
import { paymentsApi } from "@/services/paymentsApi";

import ReceiptsHeader from "@/components/receipts/ReceiptsHeader";
import PolicyReceiptsCard from "@/components/receipts/PolicyReceiptsCard";
import ReceiptModal from "@/components/receipts/ReceiptModal";

import "@/styles/receipts.css";

function fmtMoney(amount, currency = "ARS") {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function fmtDate(iso) {
  if (!iso) return "-";
  if (typeof iso === "string") {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const local = new Date(y, mo - 1, d);
      if (!Number.isNaN(local.getTime())) return local.toLocaleDateString("es-AR");
    }
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("es-AR");
}

function toDayStamp(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      return Date.UTC(y, mo - 1, d);
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

// helpers tolerantes
function pickFirst(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function getVehicleLabel(p) {
  const vehicle = p?.vehicle || p?.policy_vehicle || p?.policyVehicle || p?.contract_vehicle || null;
  const label =
    pickFirst(vehicle, ["label", "display", "name"]) ||
    [pickFirst(vehicle, ["make", "brand"]), pickFirst(vehicle, ["model"]), pickFirst(vehicle, ["year"])]
      .filter(Boolean)
      .join(" ");
  return label || "";
}

function getPlate(p) {
  const vehicle = p?.vehicle || p?.policy_vehicle || p?.policyVehicle || p?.contract_vehicle || null;
  return pickFirst(vehicle, ["plate", "license_plate", "patent"]) || pickFirst(p, ["plate"]) || "";
}

export default function ReceiptsPage() {
  const dispatch = useDispatch();
  const { policies, policiesLoading, policiesError, receiptsByPolicyPage, billingCurrentByPolicy } =
    useSelector((s) => s.receipts);

  // UI state de cards
  const [openPolicyId, setOpenPolicyId] = useState(null);
  const [pageByPolicy, setPageByPolicy] = useState({}); // policyId -> page

  // ✅ selección global de pendientes (tipo “Pagos”)
  const [selectedPendingByPolicy, setSelectedPendingByPolicy] = useState({}); // policyId -> boolean
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState("");

  useEffect(() => {
    dispatch(fetchClientPolicies());
  }, [dispatch]);

  // ✅ cuando cargan pólizas, pedimos billing_current de todas (para armar la grilla global)
  useEffect(() => {
    if (!policies?.length) return;
    policies.forEach((p) => dispatch(fetchBillingCurrentByPolicy({ policyId: p.id })));
  }, [dispatch, policies]);

  const ensureLoaded = (policyId) => {
    const page = pageByPolicy[policyId] || 1;
    dispatch(fetchReceiptsByPolicyPage({ policyId, page, pageSize: 10 }));
  };

  const onTogglePolicy = (policyId) => {
    const next = openPolicyId === policyId ? null : policyId;
    setOpenPolicyId(next);
    if (next) ensureLoaded(policyId);
  };

  const onChangePage = (policyId, nextPage) => {
    setPageByPolicy((m) => ({ ...m, [policyId]: nextPage }));
    dispatch(fetchReceiptsByPolicyPage({ policyId, page: nextPage, pageSize: 10 }));
  };

  // -------------------------
  // ✅ Pendientes globales
  // -------------------------
  const pendingItems = useMemo(() => {
    if (!policies?.length) return [];

    return policies
      .map((p) => {
        const st = billingCurrentByPolicy?.[p.id];
        const bp = st?.data || null;
        const status = String(bp?.status || "").toUpperCase();

        // “Pendiente” = existe billing_current, NO está pagado y NO está vencido
        if (!bp || status !== "UNPAID") return null;
        const todayStamp = toDayStamp(new Date());
        const hardStamp = toDayStamp(bp?.due_date_hard);
        if (hardStamp != null && todayStamp != null && todayStamp > hardStamp) return null;

        const policyNumber = pickFirst(p, ["number", "policy_number", "policyNumber"]) || "-";
        const vehicleLabel = getVehicleLabel(p) || "—";
        const plate = getPlate(p);

        return {
          policy: p,
          policyId: p.id,
          policyNumber,
          vehicleLabel,
          plate,
          billingCurrent: bp,
          amount: Number(bp.amount ?? 0),
          currency: bp.currency || "ARS",
        };
      })
      .filter(Boolean);
  }, [policies, billingCurrentByPolicy]);

  const selectedPendingItems = useMemo(() => {
    return pendingItems.filter((it) => !!selectedPendingByPolicy[it.policyId]);
  }, [pendingItems, selectedPendingByPolicy]);

  const totalSelected = useMemo(() => {
    // si manejás múltiples monedas, acá habría que separar por currency.
    return selectedPendingItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
  }, [selectedPendingItems]);

  const anyPending = pendingItems.length > 0;
  const anySelected = selectedPendingItems.length > 0;

  const onTogglePending = (policyId) => {
    setSelectedPendingByPolicy((m) => ({ ...m, [policyId]: !m[policyId] }));
  };

  const onSelectAllPending = () => {
    const next = {};
    pendingItems.forEach((it) => {
      next[it.policyId] = true;
    });
    setSelectedPendingByPolicy(next);
  };

  const onDeselectAllPending = () => {
    setSelectedPendingByPolicy({});
  };

  const onPaySelected = async () => {
    if (!anySelected || payBusy) return;
    setPayBusy(true);
    setPayErr("");
    try {
      const policyIds = selectedPendingItems.map((it) => it.policyId);
      const res = await paymentsApi.createBatchPreference(policyIds);
      const url = res?.init_point;
      if (!url) {
        setPayErr("No se pudo iniciar el pago.");
        return;
      }
      window.location.href = url;
    } catch (e) {
      setPayErr(e?.response?.data?.detail || "No se pudo iniciar el pago.");
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <div className="rcpt-wrap">
      <ReceiptsHeader />

      {policiesLoading ? (
        <div className="rcpt-muted">Cargando pólizas…</div>
      ) : policiesError ? (
        <div className="rcpt-alert">{String(policiesError)}</div>
      ) : !policies?.length ? (
        <div className="rcpt-muted">No tenés pólizas asociadas.</div>
      ) : (
        <>
          {/* ✅ Barra global estilo “Pagos pendientes” */}
          <div className="rcpt-pendingBar">
            <div className="rcpt-pendingBarHead">
              <div>
                <div className="rcpt-pendingBarTitle">Pagos pendientes</div>
                <div className="rcpt-pendingBarSub">
                  Seleccioná los períodos vigentes impagos y pagalos en conjunto.
                </div>
              </div>

              <div className="rcpt-pendingBarRight">
                <div className="rcpt-pendingTotal">
                  Total: <strong>{fmtMoney(totalSelected, "ARS")}</strong>
                </div>

                <button
                  className="rcpt-btn rcpt-btn-primary"
                  type="button"
                  disabled={!anySelected || payBusy}
                  onClick={onPaySelected}
                  title={!anySelected ? "Seleccioná al menos 1 pendiente" : "Ir a pagar"}
                >
                  {payBusy ? "Conectando…" : "Pagar seleccionados"}
                </button>
              </div>
            </div>

            {payErr ? <div className="rcpt-alert">{payErr}</div> : null}

            <div className="rcpt-pendingBarActions">
              <button
                className="rcpt-btn rcpt-btn-ghost"
                type="button"
                disabled={!anyPending}
                onClick={onSelectAllPending}
              >
                Seleccionar todo
              </button>
              <button
                className="rcpt-btn rcpt-btn-ghost"
                type="button"
                disabled={!anyPending}
                onClick={onDeselectAllPending}
              >
                Deseleccionar todo
              </button>
            </div>

            {!anyPending ? (
              <div className="rcpt-panel">
                <div className="rcpt-muted">No tenés pagos pendientes.</div>
              </div>
            ) : (
              <div className="rcpt-pendingGrid">
                {pendingItems.map((it) => {
                  const bp = it.billingCurrent;
                  const checked = !!selectedPendingByPolicy[it.policyId];
                  return (
                    <div key={it.policyId} className="rcpt-pendingCard">
                      <label className="rcpt-pendingCheck">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onTogglePending(it.policyId)}
                        />
                        <span />
                      </label>

                      <div className="rcpt-pendingMain">
                        <div className="rcpt-pendingTop">
                          <div className="rcpt-pendingPolicy">
                            Póliza <strong>{it.policyNumber}</strong>{" "}
                            {it.plate ? <span className="rcpt-pill">{it.plate}</span> : null}
                          </div>
                          <div className="rcpt-pendingAmountStrong">
                            {fmtMoney(bp.amount ?? 0, bp.currency || "ARS")}
                          </div>
                        </div>

                        <div className="rcpt-pendingMeta" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ✅ Tu listado de pólizas (comprobantes + período por póliza) */}
          <div className="rcpt-policies">
            {policies.map((p) => {
              const policyId = p.id;
              const isOpen = openPolicyId === policyId;
              const page = pageByPolicy[policyId] || 1;

              return (
                <PolicyReceiptsCard
                  key={policyId}
                  policy={p}
                  isOpen={isOpen}
                  page={page}
                  receiptsByPolicyPage={receiptsByPolicyPage}
                  onToggle={() => onTogglePolicy(policyId)}
                  onChangePage={(nextPage) => onChangePage(policyId, nextPage)}
                  onEnsureLoaded={() => ensureLoaded(policyId)}
                />
              );
            })}
          </div>
        </>
      )}

      <ReceiptModal />
    </div>
  );
}
