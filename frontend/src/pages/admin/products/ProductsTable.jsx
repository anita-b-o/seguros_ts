// src/pages/admin/products/ProductsTable.jsx
import "@/styles/adminPolicies.css";

function formatBullets(items) {
  const list = Array.isArray(items) ? items.filter((x) => String(x).trim()) : [];
  if (list.length === 0) return "-";
  return list.join(", ");
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
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Características</th>
              <th>Visible en Home</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="td-muted">
                  Cargando…
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={5} className="td-muted">
                  No hay productos para mostrar.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name || "-"}</td>
                  <td>{p.subtitle || "-"}</td>
                  <td>{formatBullets(p.bullets)}</td>
                  <td>
                    <span className={`pill ${p.published_home ? "ok" : "danger"}`}>
                      {p.published_home ? "Sí" : "No"}
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
