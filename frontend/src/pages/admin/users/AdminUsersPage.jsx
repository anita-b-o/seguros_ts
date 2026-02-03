// src/pages/admin/users/AdminUsersPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import useAuth from "@/hooks/useAuth";
import {
  clearAdminUsersErrors,
  deleteAdminUser,
  fetchAdminUsers,
  setAdminUsersPage,
  setAdminUsersQuery,
} from "@/features/adminUsers/adminUsersSlice";

import UsersTable from "./UsersTable";
import UserPoliciesModal from "./UserPoliciesModal";
import { adminUsersApi } from "@/services/adminUsersApi";
import "@/styles/adminPolicies.css";

export default function AdminUsersPage() {
  const dispatch = useDispatch();
  const { user } = useAuth();
  const isAdmin = !!user?.is_staff;

  const { list, count, page, pageSize, q, loadingList, loadingDelete, errorList } = useSelector(
    (s) => s.adminUsers
  );

  const [selectedUser, setSelectedUser] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedList, setDeletedList] = useState([]);
  const [deletedCount, setDeletedCount] = useState(0);
  const [deletedPage, setDeletedPage] = useState(1);
  const [deletedQuery, setDeletedQuery] = useState("");
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [errorDeleted, setErrorDeleted] = useState("");
  const [confirm, setConfirm] = useState({ open: false, mode: "", userRow: null });
  const [confirmBusy, setConfirmBusy] = useState(false);

  const totalPages = useMemo(() => {
    const size = Number(pageSize || 10);
    const total = Number(count || 0);
    return Math.max(1, Math.ceil(total / size));
  }, [count, pageSize]);

  const canGoPrev = !loadingList && page > 1;
  const canGoNext = !loadingList && page < totalPages;

  const deletedTotalPages = useMemo(() => {
    const size = 5;
    return Math.max(1, Math.ceil((deletedCount || 0) / size));
  }, [deletedCount]);

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
    if (showDeleted) {
      setDeletedPage(1);
      void fetchDeleted({ page: 1 });
    }
  };

  const onManagePolicies = (u) => setSelectedUser(u);

  const fetchDeleted = async ({ page: p = deletedPage, q = deletedQuery } = {}) => {
    setLoadingDeleted(true);
    setErrorDeleted("");
    try {
      const data = await adminUsersApi.listDeleted({ page: p, page_size: 5, q });
      setDeletedList(Array.isArray(data?.results) ? data.results : []);
      setDeletedCount(Number(data?.count || 0));
      setDeletedPage(p);
    } catch (e) {
      setDeletedList([]);
      setDeletedCount(0);
      setErrorDeleted("No se pudieron cargar los usuarios eliminados.");
    } finally {
      setLoadingDeleted(false);
    }
  };

  const onToggleDeleted = async () => {
    const nextShow = !showDeleted;
    setShowDeleted(nextShow);

    if (nextShow) {
      setDeletedPage(1);
      await fetchDeleted({ page: 1, q: deletedQuery });
    }
  };

  const onRestore = (userRow) => {
    if (!userRow?.id) return;
    setConfirm({ open: true, mode: "restore", userRow });
  };

  const onDelete = (userRow) => {
    if (!userRow?.id) return;
    setConfirm({ open: true, mode: "delete", userRow });
  };

  const closeConfirm = (force = false) => {
    if (confirmBusy && !force) return;
    setConfirm({ open: false, mode: "", userRow: null });
  };

  const runConfirmedAction = async () => {
    if (confirmBusy || !confirm.open || !confirm.userRow?.id) return;
    setConfirmBusy(true);
    setErrorDeleted("");

    try {
      if (confirm.mode === "delete") {
        await dispatch(deleteAdminUser(confirm.userRow.id));
      } else {
        await adminUsersApi.restore(confirm.userRow.id);
      }
      dispatch(fetchAdminUsers({ page, page_size: pageSize, q }));
      await fetchDeleted({ page: showDeleted ? deletedPage : 1, q: deletedQuery });
    } catch (e) {
      if (confirm.mode === "restore") {
        setErrorDeleted("No se pudo recuperar el usuario.");
      }
    } finally {
      setConfirmBusy(false);
      closeConfirm(true);
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Usuarios</h1>
        </div>

        <div className="admin-actions">
          <button
            className="btn-secondary"
            type="button"
            onClick={onRefresh}
            disabled={loadingList || !isAdmin}
            title={!isAdmin ? "Necesitás permisos de administrador." : ""}
          >
            {loadingList ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {!isAdmin ? (
        <div className="admin-alert">Necesitás permisos de administrador para ver esta sección.</div>
      ) : null}

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
            disabled={!isAdmin}
          />
        </div>
      </div>

      <UsersTable
        users={list}
        loading={loadingList}
        onManagePolicies={onManagePolicies}
        onDelete={onDelete}
        deleting={loadingDelete}
      />

      <div className="admin-pagination">
        <button
          className="btn-secondary"
          type="button"
          disabled={!canGoPrev}
          onClick={() => dispatch(setAdminUsersPage(page - 1))}
        >
          Anterior
        </button>

        <div className="page-chip">
          Página {page} / {totalPages}
        </div>

        <button
          className="btn-secondary"
          type="button"
          disabled={!canGoNext}
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

      {/* ELIMINADOS */}
      <div style={{ marginTop: 14 }}>
        <button className="btn-secondary" type="button" onClick={onToggleDeleted} disabled={loadingList}>
          {showDeleted ? "Ocultar eliminados" : "Ver eliminados"}
          {deletedCount ? ` (${deletedCount})` : ""}
        </button>

        {showDeleted ? (
          <div className="table-card" style={{ marginTop: 10 }}>
            <div className="table-head">
              <div className="table-title">Usuarios eliminados</div>
              <div className="table-muted">{loadingDeleted ? "Cargando…" : `${deletedList.length} ítems`}</div>
            </div>

            <div style={{ padding: 14, display: "flex", gap: 10 }}>
              <input
                className="form-input"
                value={deletedQuery}
                onChange={(e) => {
                  const next = e.target.value;
                  setDeletedQuery(next);
                  setDeletedPage(1);
                  void fetchDeleted({ page: 1, q: next });
                }}
                placeholder="Buscar eliminados por nombre, email o DNI…"
                disabled={!isAdmin}
              />
            </div>

            {errorDeleted ? (
              <div className="admin-alert" style={{ margin: 14 }}>
                {String(errorDeleted)}
              </div>
            ) : null}

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    <th>DNI</th>
                    <th style={{ textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {loadingDeleted ? (
                    <tr>
                      <td colSpan={5} className="td-muted">
                        Cargando usuarios eliminados…
                      </td>
                    </tr>
                  ) : deletedList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="td-muted">
                        No hay usuarios eliminados para mostrar.
                      </td>
                    </tr>
                  ) : (
                    deletedList.map((u) => (
                      <tr key={u.id}>
                        <td>{[u.first_name, u.last_name].filter(Boolean).join(" ") || "-"}</td>
                        <td className="mono">{u.email || "-"}</td>
                        <td className="mono">{u.phone || "-"}</td>
                        <td className="mono">{u.dni || "-"}</td>
                        <td style={{ textAlign: "right" }}>
                          <div className="row-actions">
                            <button className="btn-link" type="button" onClick={() => onRestore(u)} disabled={loadingDeleted}>
                              Recuperar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="admin-pagination" style={{ padding: "0 14px 14px" }}>
              <button
                className="btn-secondary"
                type="button"
                disabled={loadingDeleted || deletedPage <= 1}
                onClick={() => fetchDeleted({ page: deletedPage - 1, q: deletedQuery })}
              >
                Anterior
              </button>

              <div className="page-chip">
                Página {deletedPage} / {deletedTotalPages}
              </div>

              <button
                className="btn-secondary"
                type="button"
                disabled={loadingDeleted || deletedPage >= deletedTotalPages}
                onClick={() => fetchDeleted({ page: deletedPage + 1, q: deletedQuery })}
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {confirm.open ? (
        <div
          className="modal-backdrop"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="modal"
            style={{ maxWidth: 360, width: "100%", padding: 0 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ padding: "12px 14px" }}>
              <div>
                <div className="modal-title" style={{ fontSize: 15 }}>
                  {confirm.mode === "delete" ? "Confirmar eliminación" : "Confirmar recuperación"}
                </div>
                <div className="modal-sub" style={{ fontSize: 12 }}>
                  Usuarios
                </div>
              </div>
              <button className="modal-x" onClick={closeConfirm} disabled={confirmBusy}>
                ✕
              </button>
            </div>

            <div className="form modal-body" style={{ padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                {confirm.mode === "delete"
                  ? "¿Eliminar este usuario?"
                  : "¿Recuperar este usuario?"}
              </div>

              <div className="rcpt-muted" style={{ padding: 0, fontSize: 12 }}>
                {confirm.userRow?.email
                  ? `Usuario: ${confirm.userRow.email}`
                  : confirm.userRow?.dni
                  ? `DNI: ${confirm.userRow.dni}`
                  : confirm.userRow?.id
                  ? `ID: ${confirm.userRow.id}`
                  : ""}
              </div>

              {confirm.mode === "delete" ? (
                <div className="rcpt-muted" style={{ padding: "8px 0 0", fontSize: 12 }}>
                  Las pólizas asociadas a este usuario quedarán sin cliente. El usuario no
                  aparecerá en el listado de clientes para asignar pólizas.
                </div>
              ) : (
                <div className="rcpt-muted" style={{ padding: "8px 0 0", fontSize: 12 }}>
                  El usuario volverá a aparecer en el listado de clientes para asignar pólizas.
                </div>
              )}

              <div
                className="modal-actions"
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={closeConfirm}
                  disabled={confirmBusy}
                  style={{ padding: "6px 10px" }}
                >
                  Cancelar
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={runConfirmedAction}
                  disabled={confirmBusy}
                  style={{ padding: "6px 12px" }}
                >
                  {confirmBusy ? "Procesando…" : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
