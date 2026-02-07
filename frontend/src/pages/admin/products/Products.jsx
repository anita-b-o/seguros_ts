// src/pages/admin/products/Products.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import useAuth from "@/hooks/useAuth";
import { adminProductsApi } from "@/services/adminProductsApi";
import "@/styles/adminPolicies.css";

import ProductsTable from "./ProductsTable";
import ProductFormModal from "./ProductFormModal";

export default function AdminProductsPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_staff;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [count, setCount] = useState(0);
  const [list, setList] = useState([]);

  const [q, setQ] = useState("");

  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedPage, setDeletedPage] = useState(1);
  const [deletedCount, setDeletedCount] = useState(0);
  const [deletedList, setDeletedList] = useState([]);
  const [deletedQuery, setDeletedQuery] = useState("");
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [errorDeleted, setErrorDeleted] = useState("");
  const [confirm, setConfirm] = useState({ open: false, mode: "", item: null });
  const [confirmBusy, setConfirmBusy] = useState(false);
  const searchTimer = useRef(null);
  const requestIdRef = useRef(0);
  const deletedRequestIdRef = useRef(0);

  const load = async ({ p = page, query = q } = {}) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setErr("");
    try {
      const data = await adminProductsApi.list({ page: p, page_size: pageSize, q: query });
      if (requestIdRef.current !== requestId) return;
      const items = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setList(items);
      setCount(Number(data?.count ?? items.length ?? 0));
      setPage(p);
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setList([]);
      setCount(0);
      setErr("No se pudieron cargar los productos (tipos de seguro).");
    } finally {
      if (requestIdRef.current !== requestId) return;
      setLoading(false);
    }
  };

  const fetchDeleted = async ({ page: p = deletedPage, search = deletedQuery } = {}) => {
    if (!isAdmin) return;
    const requestId = ++deletedRequestIdRef.current;
    setLoadingDeleted(true);
    setErrorDeleted("");
    try {
      const data = await adminProductsApi.listDeleted({
        page: p,
        page_size: 5,
        q: search,
      });
      if (deletedRequestIdRef.current !== requestId) return;
      const items = Array.isArray(data?.results) ? data.results : [];
      setDeletedList(items);
      setDeletedCount(Number(data?.count || 0));
      setDeletedPage(p);
    } catch (e) {
      if (deletedRequestIdRef.current !== requestId) return;
      setDeletedList([]);
      setDeletedCount(0);
      setErrorDeleted("No se pudieron cargar los productos eliminados.");
    } finally {
      if (deletedRequestIdRef.current !== requestId) return;
      setLoadingDeleted(false);
    }
  };

  const onToggleDeleted = async () => {
    if (!isAdmin) return;
    const nextShow = !showDeleted;
    setShowDeleted(nextShow);
    if (nextShow) {
      setDeletedPage(1);
      await fetchDeleted({ page: 1, search: deletedQuery });
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void load({ p: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      requestIdRef.current += 1;
      deletedRequestIdRef.current += 1;
    };
  }, [isAdmin]);

  const onRefresh = () => void load({ p: 1 });

  const onQueryChange = (e) => {
    const next = e.target.value;
    setQ(next);
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      void load({ p: 1, query: next });
    }, 300);
  };

  const onEdit = async (row) => {
    if (!row?.id) return;
    setLoadingEdit(true);
    setErr("");
    try {
      const full = await adminProductsApi.get(row.id);
      setEditing(full);
    } catch {
      setEditing(null);
      setErr("No se pudo cargar el detalle del producto para editar.");
    } finally {
      setLoadingEdit(false);
    }
  };

  const onDelete = async (row) => {
    if (!row?.id) return;
    setConfirm({ open: true, mode: "delete", item: row });
  };

  const onRestore = async (row) => {
    if (!row?.id) return;
    setConfirm({ open: true, mode: "restore", item: row });
  };

  const closeConfirm = (force = false) => {
    if (confirmBusy && !force) return;
    setConfirm({ open: false, mode: "", item: null });
  };

  const runConfirmedAction = async () => {
    if (confirmBusy || !confirm.open || !confirm.item?.id) return;
    setConfirmBusy(true);

    const row = confirm.item;
    const isDelete = confirm.mode === "delete";

    setErr("");
    setErrorDeleted("");
    try {
      if (isDelete) {
        await adminProductsApi.remove(row.id);
      } else {
        await adminProductsApi.restore(row.id);
      }
      await load({ p: Math.max(1, page) });
      await fetchDeleted({ page: showDeleted ? deletedPage : 1, search: deletedQuery });
    } catch (e) {
      if (isDelete) {
        setErr("No se pudo eliminar el producto.");
      } else {
        setErrorDeleted("No se pudo recuperar el producto.");
      }
    } finally {
      setConfirmBusy(false);
      closeConfirm(true);
    }
  };

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil((count || 0) / pageSize));
  }, [count, pageSize]);

  const deletedTotalPages = useMemo(() => {
    const size = 5;
    return Math.max(1, Math.ceil((deletedCount || 0) / size));
  }, [deletedCount]);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Productos</h1>
        </div>

        <div className="admin-actions">
          <button className="btn-secondary" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>

          {isAdmin ? (
            <button
              className="btn-primary"
              type="button"
              onClick={() => setOpenCreate(true)}
            >
              + Crear seguro
            </button>
          ) : null}
        </div>
      </div>

      {err ? <div className="admin-alert">{String(err)}</div> : null}

      <div className="table-card" style={{ marginBottom: 14 }}>
        <div className="table-head">
          <div className="table-title">Búsqueda</div>
          <div className="table-muted">Total: {count}</div>
        </div>
        <div style={{ padding: 14, display: "flex", gap: 10 }}>
          <input
            className="form-input"
            value={q}
            onChange={onQueryChange}
            placeholder="Buscar por nombre o código…"
            disabled={!isAdmin}
          />
        </div>
      </div>

      <ProductsTable
        products={list}
        loading={loading}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      <div className="admin-pagination">
        <button
          className="btn-secondary"
          type="button"
          disabled={loading || page <= 1}
          onClick={() => load({ p: page - 1 })}
        >
          Anterior
        </button>

        <div className="page-chip">
          Página {page} / {totalPages}
        </div>

        <button
          className="btn-secondary"
          type="button"
          disabled={loading || page >= totalPages}
          onClick={() => load({ p: page + 1 })}
        >
          Siguiente
        </button>
      </div>

      <ProductFormModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onSaved={() => load({ p: 1 })}
      />

      {loadingEdit ? (
        <div className="admin-alert" style={{ marginTop: 12 }}>
          Cargando detalle para editar…
        </div>
      ) : null}

      <ProductFormModal
        open={!!editing}
        onClose={() => setEditing(null)}
        product={editing}
        onSaved={() => load({ p: Math.max(1, page) })}
      />

      {isAdmin ? (
        <div style={{ marginTop: 14 }}>
        <button
          className="btn-secondary"
          type="button"
          onClick={onToggleDeleted}
          disabled={loading || !isAdmin}
          title={!isAdmin ? "Necesitás permisos de administrador." : ""}
        >
          {showDeleted ? "Ocultar eliminados" : "Ver eliminados"}
          {deletedCount ? ` (${deletedCount})` : ""}
        </button>

        {showDeleted ? (
          <div className="table-card" style={{ marginTop: 10 }}>
            <div className="table-head">
              <div className="table-title">Productos eliminados</div>
              <div className="table-muted">
                {loadingDeleted ? "Cargando…" : `${deletedList.length} ítems`}
              </div>
            </div>

            <div style={{ padding: 14, display: "flex", gap: 10 }}>
              <input
                className="form-input"
                value={deletedQuery}
                onChange={(e) => {
                  const next = e.target.value;
                  setDeletedQuery(next);
                  setDeletedPage(1);
                  void fetchDeleted({ page: 1, search: next });
                }}
                placeholder="Buscar eliminados por nombre o código…"
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
                    <th>Descripción</th>
                    <th>Características</th>
                    <th style={{ textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {loadingDeleted ? (
                    <tr>
                      <td colSpan={4} className="td-muted">
                        Cargando productos eliminados…
                      </td>
                    </tr>
                  ) : deletedList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="td-muted">
                        No hay productos eliminados para mostrar.
                      </td>
                    </tr>
                  ) : (
                    deletedList.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name || "-"}</td>
                        <td>{p.subtitle || "-"}</td>
                        <td>
                          {Array.isArray(p.bullets) && p.bullets.length
                            ? p.bullets.join(", ")
                            : "-"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className="row-actions">
                            <button
                              className="btn-link"
                              type="button"
                              onClick={() => onRestore(p)}
                              disabled={loadingDeleted}
                            >
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
                onClick={() => fetchDeleted({ page: deletedPage - 1, search: deletedQuery })}
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
                onClick={() => fetchDeleted({ page: deletedPage + 1, search: deletedQuery })}
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

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
                  Productos
                </div>
              </div>
              <button className="modal-x" onClick={closeConfirm} disabled={confirmBusy}>
                ✕
              </button>
            </div>

            <div className="form modal-body" style={{ padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                {confirm.mode === "delete"
                  ? "¿Eliminar este producto?"
                  : "¿Recuperar este producto?"}
              </div>

              <div className="rcpt-muted" style={{ padding: 0, fontSize: 12 }}>
                {confirm.item?.name
                  ? `Producto: ${confirm.item.name}`
                  : confirm.item?.code
                  ? `Código: ${confirm.item.code}`
                  : confirm.item?.id
                  ? `ID: ${confirm.item.id}`
                  : ""}
              </div>

              {confirm.mode === "delete" ? (
                <div className="rcpt-muted" style={{ padding: "8px 0 0", fontSize: 12 }}>
                  Todas las pólizas con este producto asignado quedarán sin producto.
                </div>
              ) : (
                <div className="rcpt-muted" style={{ padding: "8px 0 0", fontSize: 12 }}>
                  El producto volverá a estar disponible para asignar a pólizas.
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
