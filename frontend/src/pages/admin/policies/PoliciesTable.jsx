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

  const statusLabel = (raw) => {
    const key = String(raw || "").toLowerCase();
    const map = {
      active: "Activa",
      expired: "Vencida",
      cancelled: "Cancelada",
      suspended: "Suspendida",
      unknown: "Desconocido",
    };
    return map[key] || (raw ? String(raw) : "Desconocido");
  };

  // ✅ Quitamos columnas: Billing
  const COLS = 7;

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
              <th>Monto</th>
              <th>Estado</th>
              <th>Vigencia</th>
              <th>Pagó</th>
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
                const paid = !Boolean(pending);

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
                        {statusLabel(p.status)}
                      </span>
                    </td>

                    <td className="mono">{vigRange}</td>

                    <td>
                      {paid ? (
                        <span className="pill ok">Sí</span>
                      ) : (
                        <span className="pill danger">No</span>
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
