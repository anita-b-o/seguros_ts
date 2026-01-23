// src/pages/admin/users/UsersTable.jsx
import "@/styles/adminPolicies.css";

export default function UsersTable({ users, loading, onManagePolicies }) {
  return (
    <div className="table-card" style={{ marginTop: 14 }}>
      <div className="table-head">
        <div className="table-title">Listado</div>
        <div className="table-muted">{loading ? "Cargando…" : `${users.length} ítems`}</div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Teléfono</th>
              <th>DNI</th>
              <th>Activo</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="td-muted">
                  Cargando usuarios…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="td-muted">
                  No hay usuarios para mostrar.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td>{[u.first_name, u.last_name].filter(Boolean).join(" ") || "-"}</td>
                  <td className="mono">{u.email || "-"}</td>
                  <td className="mono">{u.phone || "-"}</td>
                  <td className="mono">{u.dni || "-"}</td>
                  <td>
                    <span className={`pill ${u.is_active ? "ok" : "danger"}`}>
                      {u.is_active ? "Sí" : "No"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="row-actions">
                      <button className="btn-link" type="button" onClick={() => onManagePolicies(u)}>
                        Gestionar pólizas
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
