// src/pages/dashboard/ReceiptsPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

import {
  fetchClientPolicies,
  fetchReceiptsByPolicyPage,
  fetchBillingCurrentByPolicy,
} from "@/features/receipts/receiptsSlice";

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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("es-AR");
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
  const navigate = useNavigate();

  const {
    policies,
    policiesLoading,
    policiesError,
    receiptsByPolicyPage,
    billingCurrentByPolicy,
  } = useSelector((s) => s.receipts);

  // UI state de cards
  const [openPolicyId, setOpenPolicyId] = useState(null);
  const [tabByPolicy, setTabByPolicy] = useState({}); // policyId -> "receipts" | "pending"
  const [pageByPolicy, setPageByPolicy] = useState({}); // policyId -> page

  // ✅ selección global de pendientes (tipo “Pagos”)
  const [selectedPendingByPolicy, setSelectedPendingByPolicy] = useState({}); // policyId -> boolean

  useEffect(() => {
    dispatch(fetchClientPolicies());
  }, [dispatch]);

  // ✅ cuando cargan pólizas, pedimos billing_current de todas (para armar la grilla global)
  useEffect(() => {
    if (!policies?.length) return;
    policies.forEach((p) => dispatch(fetchBillingCurrentByPolicy({ policyId: p.id })));
  }, [dispatch, policies]);

  const ensureLoaded = (policyId) => {
    const tab = tabByPolicy[policyId] || "receipts";
    const page = pageByPolicy[policyId] || 1;

    if (tab === "receipts") {
      dispatch(fetchReceiptsByPolicyPage({ policyId, page, pageSize: 10 }));
    } else {
      dispatch(fetchBillingCurrentByPolicy({ policyId }));
    }
  };

  const onTogglePolicy = (policyId) => {
    const next = openPolicyId === policyId ? null : policyId;
    setOpenPolicyId(next);
    if (next) ensureLoaded(policyId);
  };

  const onSwitchTab = (policyId, tab) => {
    setTabByPolicy((m) => ({ ...m, [policyId]: tab }));

    if (tab === "receipts") {
      const page = pageByPolicy[policyId] || 1;
      dispatch(fetchReceiptsByPolicyPage({ policyId, page, pageSize: 10 }));
    } else {
      dispatch(fetchBillingCurrentByPolicy({ policyId }));
    }
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

        // “Pendiente” = existe billing_current y NO está pagado
        if (!bp || status === "PAID") return null;

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

  const onPaySelected = () => {
    if (!anySelected) return;

    // armamos “items” para la página de pagos
    const items = selectedPendingItems.map((it) => ({
      policyId: it.policyId,
      // si el backend trae ID del billing period, pasalo:
      billingPeriodId: it.billingCurrent?.id ?? null,
      amount: it.amount,
      currency: it.currency,
      period_code: it.billingCurrent?.period_code ?? null,
      due_date_soft: it.billingCurrent?.due_date_soft ?? null,
      due_date_hard: it.billingCurrent?.due_date_hard ?? null,
      policyNumber: it.policyNumber,
      plate: it.plate || null,
    }));

    navigate("/dashboard/pagos", { state: { items } });
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
                  disabled={!anySelected}
                  onClick={onPaySelected}
                  title={!anySelected ? "Seleccioná al menos 1 pendiente" : "Ir a pagar"}
                >
                  Pagar seleccionados
                </button>
              </div>
            </div>

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

                        <div className="rcpt-pendingMeta">
                          <div className="rcpt-pendingMetaRow">
                            <span className="rcpt-pendingMetaK">Vehículo</span>
                            <span className="rcpt-pendingMetaV">{it.vehicleLabel || "—"}</span>
                          </div>
                          <div className="rcpt-pendingMetaRow">
                            <span className="rcpt-pendingMetaK">Período</span>
                            <span className="rcpt-pendingMetaV">{bp.period_code || "—"}</span>
                          </div>
                          <div className="rcpt-pendingMetaRow">
                            <span className="rcpt-pendingMetaK">Vence (cliente)</span>
                            <span className="rcpt-pendingMetaV">
                              <strong>{fmtDate(bp.due_date_soft)}</strong>
                            </span>
                          </div>
                          <div className="rcpt-pendingMetaRow">
                            <span className="rcpt-pendingMetaK">Cierre real</span>
                            <span className="rcpt-pendingMetaV">
                              <strong>{fmtDate(bp.due_date_hard)}</strong>
                            </span>
                          </div>
                        </div>
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
              const tab = tabByPolicy[policyId] || "receipts";
              const page = pageByPolicy[policyId] || 1;

              return (
                <PolicyReceiptsCard
                  key={policyId}
                  policy={p}
                  isOpen={isOpen}
                  tab={tab}
                  page={page}
                  receiptsByPolicyPage={receiptsByPolicyPage}
                  billingCurrentByPolicy={billingCurrentByPolicy}
                  onToggle={() => onTogglePolicy(policyId)}
                  onSwitchTab={(nextTab) => onSwitchTab(policyId, nextTab)}
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
