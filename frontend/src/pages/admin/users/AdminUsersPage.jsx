// src/pages/admin/users/AdminUsersPage.jsx
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import useAuth from "@/hooks/useAuth";
import {
  clearAdminUsersErrors,
  fetchAdminUsers,
  setAdminUsersPage,
  setAdminUsersQuery,
} from "@/features/adminUsers/adminUsersSlice";

import UsersTable from "./UsersTable";
import UserPoliciesModal from "./UserPoliciesModal";
import "@/styles/adminPolicies.css";

export default function AdminUsersPage() {
  const dispatch = useDispatch();
  const { user } = useAuth();
  const isAdmin = !!user?.is_staff;

  const { list, count, page, pageSize, q, loadingList, errorList } = useSelector(
    (s) => s.adminUsers
  );

  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    dispatch(fetchAdminUsers({ page, page_size: pageSize, q }));
  }, [dispatch, isAdmin, page, pageSize, q]);

  useEffect(() => {
    dispatch(clearAdminUsersErrors());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    dispatch(clearAdminUsersErrors());
    dispatch(fetchAdminUsers({ page, page_size: pageSize, q }));
  };

  const onManagePolicies = (u) => setSelectedUser(u);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Usuarios</h1>
          <p className="admin-sub">
            Listado de clientes y administración de pólizas asociadas.
          </p>
        </div>

        <div className="admin-actions">
          <button className="btn-secondary" type="button" onClick={onRefresh} disabled={loadingList}>
            {loadingList ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {errorList ? <div className="admin-alert">{String(errorList)}</div> : null}

      <div className="table-card" style={{ marginBottom: 14 }}>
        <div className="table-head">
          <div className="table-title">Búsqueda</div>
          <div className="table-muted">Total: {count}</div>
        </div>
        <div style={{ padding: 14, display: "flex", gap: 10 }}>
          <input
            className="form-input"
            value={q}
            onChange={(e) => dispatch(setAdminUsersQuery(e.target.value))}
            placeholder="Buscar por nombre, email o DNI…"
          />
        </div>
      </div>

      <UsersTable users={list} loading={loadingList} onManagePolicies={onManagePolicies} />

      <div className="admin-pagination">
        <button
          className="btn-secondary"
          type="button"
          disabled={page <= 1 || loadingList}
          onClick={() => dispatch(setAdminUsersPage(page - 1))}
        >
          Anterior
        </button>

        <div className="page-chip">Página {page}</div>

        <button
          className="btn-secondary"
          type="button"
          disabled={loadingList || list.length === 0}
          onClick={() => dispatch(setAdminUsersPage(page + 1))}
        >
          Siguiente
        </button>
      </div>

      <UserPoliciesModal
        open={!!selectedUser}
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
      />
    </div>
  );
}
