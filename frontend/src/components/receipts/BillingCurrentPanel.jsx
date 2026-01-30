// src/components/receipts/BillingCurrentPanel.jsx
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

export default function BillingCurrentPanel({ state }) {
  if (state?.loading) return <div className="rcpt-muted">Cargando período vigente…</div>;
  if (state?.error) return <div className="rcpt-alert">{String(state.error)}</div>;

  const bp = state?.data || null;
  if (!bp) return <div className="rcpt-muted">No hay período vigente.</div>;

  const status = String(bp.status || "").toUpperCase();
  const isPaid = status === "PAID";

  if (isPaid) return <div className="rcpt-muted">No hay pendientes para esta póliza.</div>;

  return (
    <div className="rcpt-panel">
      <div className="rcpt-pending">
        <div className="rcpt-pendingRow">
          <div>
            <div className="rcpt-pendingTitle">
              Período vigente {bp.period_code ? `(${bp.period_code})` : ""}
            </div>
            <div className="rcpt-pendingSub">
              Vence (cliente): <strong>{fmtDate(bp.due_date_soft)}</strong> · Cierre real:{" "}
              <strong>{fmtDate(bp.due_date_hard)}</strong>
            </div>
          </div>
          <div className="rcpt-pendingAmount">
            {fmtMoney(bp.amount ?? 0, bp.currency || "ARS")}
          </div>
        </div>
      </div>
    </div>
  );
}
