// src/components/receipts/ReceiptsList.jsx
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

export default function ReceiptsList({
  state,
  page,
  onClickReceipt,
  onPrev,
  onNext,
}) {
  if (state?.loading) return <div className="rcpt-muted">Cargando comprobantes…</div>;
  if (state?.error) return <div className="rcpt-alert">{String(state.error)}</div>;

  const results = state?.results || [];

  return (
    <div className="rcpt-panel">
      {results.length ? (
        <>
          <div className="rcpt-list">
            {results.map((r) => (
              <button
                key={r.id}
                className="rcpt-rowBtn"
                onClick={() => onClickReceipt(r)}
                type="button"
              >
                <div className="rcpt-rowMain">
                  <div className="rcpt-rowTitle">
                    {fmtDate(r.date || r.issued_at || r.created_at)}
                  </div>
                  <div className="rcpt-rowSub">{r.concept || "Comprobante"}</div>
                </div>
                <div className="rcpt-rowAmount">
                  {fmtMoney(r.amount ?? 0, r.currency || "ARS")}
                </div>
              </button>
            ))}
          </div>

          <div className="rcpt-pager">
            <button
              className="rcpt-btn rcpt-btn-ghost"
              disabled={!state?.previous || page <= 1}
              onClick={onPrev}
              type="button"
            >
              Anterior
            </button>
            <div className="rcpt-pagerInfo">
              Página <strong>{page}</strong>
            </div>
            <button
              className="rcpt-btn rcpt-btn-ghost"
              disabled={!state?.next}
              onClick={onNext}
              type="button"
            >
              Siguiente
            </button>
          </div>

          <div className="rcpt-hint">
            Se muestran 10 comprobantes por página. Tocá uno para ver el detalle.
          </div>
        </>
      ) : (
        <div className="rcpt-muted">No hay comprobantes para esta póliza.</div>
      )}
    </div>
  );
}
