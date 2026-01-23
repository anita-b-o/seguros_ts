// src/pages/admin/products/ProductsTable.jsx
import "@/styles/adminPolicies.css";

function fmtRange(a, b) {
  if (!a && !b) return "-";
  if (a && b) return `${a} → ${b}`;
  return a || b || "-";
}

export default function ProductsTable({ products = [], loading, onEdit, onDelete }) {
  return (
    <div className="table-card">
      <div className="table-head">
        <div className="table-title">Listado</div>
        <div className="table-muted">{loading ? "Cargando…" : `${products.length} ítems`}</div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Plan</th>
              <th>Vehículo</th>
              <th>Años</th>
              <th>Precio base</th>
              <th>Visible Home</th>
              <th>Activo</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="td-muted">
                  Cargando…
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={9} className="td-muted">
                  No hay productos para mostrar.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.code || "-"}</td>
                  <td>{p.name || "-"}</td>
                  <td className="mono">{p.plan_type || "-"}</td>
                  <td className="mono">{p.vehicle_type || "-"}</td>
                  <td className="mono">{fmtRange(p.min_year, p.max_year)}</td>
                  <td className="mono">{p.base_price ?? "-"}</td>
                  <td>
                    <span className={`pill ${p.published_home ? "ok" : "danger"}`}>
                      {p.published_home ? "Sí" : "No"}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${p.is_active ? "ok" : "danger"}`}>
                      {p.is_active ? "Sí" : "No"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="row-actions">
                      <button className="btn-link" type="button" onClick={() => onEdit?.(p)}>
                        Editar
                      </button>
                      <button className="btn-link danger" type="button" onClick={() => onDelete?.(p)}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
