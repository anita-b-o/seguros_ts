export default function PoliciesTable({
  policies,
  loading,
  onEdit,
  onDelete,
  deleting,
}) {
  const fmtRange = (a, b) => {
    if (!a && !b) return "-";
    if (a && b) return `${a} → ${b}`;
    return a || b || "-";
  };

  // helper: compat hacia atrás
  const pickFirst = (obj, keys) => {
    if (!obj) return null;
    for (const k of keys) {
      const v = obj?.[k];
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  };

  // ✅ Quitamos columnas: Período pago / Vence visible / Vence real / Ajuste
  const COLS = 8;

  return (
    <div className="table-card">
      <div className="table-head">
        <div className="table-title">Listado</div>
        <div className="table-muted">
          {loading ? "Cargando…" : `${policies.length} ítems`}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Producto</th>
              <th>Premium</th>
              <th>Status</th>
              <th>Billing</th>
              <th>Vigencia</th>
              <th>Pendiente</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLS} className="td-muted">
                  Cargando pólizas…
                </td>
              </tr>
            ) : policies.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="td-muted">
                  No hay pólizas para mostrar.
                </td>
              </tr>
            ) : (
              policies.map((p) => {
                const vigRange = fmtRange(p.start_date, p.end_date);

                // Pendiente: robusto ante null/undefined y compat con posibles claves alternativas
                const pending =
                  pickFirst(p, ["has_pending_charge", "pending", "is_pending"]) ?? false;

                // Período de ajuste (backend-first)
                const isInAdjustment = Boolean(
                  pickFirst(p, ["is_in_adjustment", "in_adjustment", "is_adjustment_window"]) ??
                    false
                );

                return (
                  <tr
                    key={p.id}
                    className={isInAdjustment ? "row-adjustment" : undefined}
                  >
                    <td className="mono">
                      {p.number}
                      {isInAdjustment ? (
                        <span className="pill warn" style={{ marginLeft: 8 }}>
                          Ajuste
                        </span>
                      ) : null}
                    </td>

                    <td>{p.product_name || "-"}</td>
                    <td className="mono">{p.premium}</td>

                    <td>
                      <span className={`badge ${p.status || "unknown"}`}>
                        {p.status || "unknown"}
                      </span>
                    </td>

                    <td>
                      <span className={`badge ${String(p.billing_status || "unknown")}`}>
                        {p.billing_status || "unknown"}
                      </span>
                    </td>

                    <td className="mono">{vigRange}</td>

                    <td>
                      {Boolean(pending) ? (
                        <span className="pill danger">Sí</span>
                      ) : (
                        <span className="pill ok">No</span>
                      )}
                    </td>

                    <td style={{ textAlign: "right" }}>
                      <div className="row-actions">
                        <button className="btn-link" type="button" onClick={() => onEdit(p)}>
                          Editar
                        </button>

                        <button
                          className="btn-link danger"
                          type="button"
                          onClick={() => onDelete(p)}
                          disabled={deleting}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
