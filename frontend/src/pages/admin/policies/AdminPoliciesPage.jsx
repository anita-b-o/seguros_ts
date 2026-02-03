import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import useAuth from "@/hooks/useAuth";
import {
  clearAdminPoliciesErrors,
  deleteAdminPolicy,
  fetchAdminPolicies,
  setAdminPoliciesPage,
  setAdminPoliciesQuery,
} from "@/features/adminPolicies/adminPoliciesSlice";

import { adminPoliciesApi } from "@/services/adminPoliciesApi";
import { api } from "@/api/http";

import PoliciesTable from "./PoliciesTable";
import PolicyFormModal from "./PolicyFormModal";
import "@/styles/adminPolicies.css";

const pickFirst = (obj, keys) => {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
};

function fmtRange(a, b) {
  if (!a && !b) return "-";
  if (a && b) return `${a} → ${b}`;
  return a || b || "-";
}

function groupCounts(list) {
  const total = list.length;

  // Robust: soporta variaciones (has_pending_charge / pending / is_pending)
  const pending = list.filter((p) => {
    const v = pickFirst(p, ["has_pending_charge", "pending", "is_pending"]);
    return Boolean(v);
  }).length;

  const byStatus = list.reduce((acc, p) => {
    const k = p.billing_status || "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return { total, pending, byStatus };
}

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

const userLabel = (u) => {
  if (!u) return "";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.full_name || u.email || u.username || (u.id ? `ID: ${u.id}` : "");
};

/* -----------------------
 * Modal lista (selector)
 * - Compacto (sin scroll horizontal)
 * - Columna Acción fija
 * - Fila clickeable + botón Abrir
 * ---------------------- */
function ListModal({ open, title, subtitle, items, loading, error, onPick, onClose }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-sm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{title || "Listado"}</div>
            {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ padding: 12 }}>
          {error ? <div className="admin-alert">{String(error)}</div> : null}

          {loading ? (
            <div className="td-muted">Cargando…</div>
          ) : !items?.length ? (
            <div className="td-muted">No hay pólizas para mostrar.</div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th className="th-action">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr
                      key={it.id}
                      className="row-clickable"
                      onClick={() => onPick?.(it)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onPick?.(it);
                      }}
                    >
                      <td className="mono">{it.number}</td>
                      <td className="td-action" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-link" type="button" onClick={() => onPick?.(it)}>
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ padding: "0 12px 12px" }}>
          <button className="btn-secondary" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPoliciesPage() {
  const dispatch = useDispatch();
  const { user } = useAuth();

  // ✅ Traemos next/previous del slice para controlar paginado real
  const { list, count, page, q, loadingList, loadingDelete, errorList, next, previous } =
    useSelector((s) => s.adminPolicies);

  const [openCreate, setOpenCreate] = useState(false);

  const [editing, setEditing] = useState(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editErr, setEditErr] = useState("");

  // --- Eliminadas (dropdown) ---
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedPage, setDeletedPage] = useState(1);
  const [deletedCount, setDeletedCount] = useState(0);
  const [deletedList, setDeletedList] = useState([]);
  const [deletedQuery, setDeletedQuery] = useState("");
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [errorDeleted, setErrorDeleted] = useState("");
  const [confirm, setConfirm] = useState({ open: false, mode: "", policy: null });
  const [confirmBusy, setConfirmBusy] = useState(false);

  // --- Stats (tarjetas) ---
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsErr, setStatsErr] = useState("");

  const [statusItemsCache, setStatusItemsCache] = useState({});

  // --- Modal de lista (selector) ---
  const [listModalOpen, setListModalOpen] = useState(false);
  const [listModalTitle, setListModalTitle] = useState("");
  const [listModalSubtitle, setListModalSubtitle] = useState("");
  const [listModalItems, setListModalItems] = useState([]);
  const [listModalLoading, setListModalLoading] = useState(false);
  const [listModalError, setListModalError] = useState("");

  const isAdmin = !!user?.is_staff;

  // ✅ LIST: cuando cambie page, trae la página
  useEffect(() => {
    dispatch(fetchAdminPolicies({ page, search: q }));
  }, [dispatch, page, q]);

  useEffect(() => {
    dispatch(clearAdminPoliciesErrors());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Cargar stats al montar
  const fetchStats = async () => {
    setLoadingStats(true);
    setStatsErr("");
    try {
      const { data } = await api.get("/admin/policies/policies/stats/");
      setStats(data || null);
    } catch (e) {
      setStats(null);
      setStatsErr("No se pudieron cargar las métricas del panel.");
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // (no se usa en el render, pero lo dejo por si lo querés mostrar)
  const metrics = useMemo(() => groupCounts(list), [list]); // eslint-disable-line no-unused-vars

  const fetchDeleted = async ({ page: p = deletedPage, search = deletedQuery } = {}) => {
    setLoadingDeleted(true);
    setErrorDeleted("");
    try {
      const data = await adminPoliciesApi.listDeleted({ page: p, page_size: 5, search });
      setDeletedList(Array.isArray(data?.results) ? data.results : []);
      setDeletedCount(Number(data?.count || 0));
      setDeletedPage(p);
    } catch (e) {
      setDeletedList([]);
      setDeletedCount(0);
      setErrorDeleted("No se pudieron cargar las pólizas eliminadas.");
    } finally {
      setLoadingDeleted(false);
    }
  };

  const onToggleDeleted = async () => {
    const nextShow = !showDeleted;
    setShowDeleted(nextShow);

    if (nextShow) {
      setDeletedPage(1);
      await fetchDeleted({ page: 1, search: deletedQuery });
    }
  };

  const onRestore = (policy) => {
    if (!policy?.id) return;
    setConfirm({ open: true, mode: "restore", policy });
  };

  const onRefresh = () => {
    dispatch(clearAdminPoliciesErrors());
    setEditing(null);
    setEditErr("");

    dispatch(fetchAdminPolicies({ page }));

    if (showDeleted) {
      setDeletedPage(1);
      void fetchDeleted({ page: 1, search: deletedQuery });
    }

    void fetchStats();
  };

  const onEdit = async (policyRow) => {
    if (!policyRow?.id) return;

    setEditErr("");
    setLoadingEdit(true);
    try {
      const full = await adminPoliciesApi.get(policyRow.id);
      setEditing(full);
    } catch (e) {
      setEditing(null);
      setEditErr("No se pudo cargar el detalle de la póliza para editar.");
    } finally {
      setLoadingEdit(false);
    }
  };

  const onEditById = async (id) => {
    if (!id) return;
    await onEdit({ id });
  };

  const onCloseEdit = () => {
    setEditing(null);
    setEditErr("");
  };

  const onDelete = (policy) => {
    if (!policy?.id) return;
    setConfirm({ open: true, mode: "delete", policy });
  };

  const closeConfirm = (force = false) => {
    if (confirmBusy && !force) return;
    setConfirm({ open: false, mode: "", policy: null });
  };

  const runConfirmedAction = async () => {
    if (confirmBusy || !confirm.open || !confirm.policy?.id) return;
    setConfirmBusy(true);
    setErrorDeleted("");

    try {
      if (confirm.mode === "delete") {
        await dispatch(deleteAdminPolicy(confirm.policy.id));
      } else {
        await adminPoliciesApi.restore(confirm.policy.id);
      }

      dispatch(fetchAdminPolicies({ page }));
      await fetchDeleted({ page: showDeleted ? deletedPage : 1, search: deletedQuery });
      void fetchStats();
    } catch (e) {
      if (confirm.mode === "delete") {
        // error de borrado se maneja en slice, pero mostramos fallback
        // eslint-disable-next-line no-console
        console.error(e);
      } else {
        setErrorDeleted("No se pudo recuperar la póliza.");
      }
    } finally {
      setConfirmBusy(false);
      closeConfirm(true);
    }
  };

  const deletedTotalPages = useMemo(() => {
    const size = 5;
    return Math.max(1, Math.ceil((deletedCount || 0) / size));
  }, [deletedCount]);

  /* -----------------------
   * Apertura de ListModal
   * ---------------------- */
  const openList = ({ title, subtitle = "", items = [], loading = false, error = "" }) => {
    setListModalTitle(title || "Listado");
    setListModalSubtitle(subtitle || "");
    setListModalItems(Array.isArray(items) ? items : []);
    setListModalLoading(Boolean(loading));
    setListModalError(error || "");
    setListModalOpen(true);
  };

  const closeList = () => {
    setListModalOpen(false);
    setListModalTitle("");
    setListModalSubtitle("");
    setListModalItems([]);
    setListModalLoading(false);
    setListModalError("");
  };

  const onPickFromList = async (it) => {
    closeList();
    await onEditById(it?.id);
  };

  /* -----------------------
   * Click: tarjetas stats
   * ---------------------- */
  const onClickAdjustmentCard = () => {
    const items = stats?.adjustment?.items || [];
    const c = Number(stats?.adjustment?.count || items.length || 0);
    openList({
      title: "Pólizas en período de ajuste",
      subtitle: `${c} pólizas`,
      items,
    });
  };

  const onClickSoftOverdueCard = () => {
    const items = stats?.soft_overdue_unpaid?.items || [];
    const c = Number(stats?.soft_overdue_unpaid?.count || items.length || 0);
    openList({
      title: "No abonadas (vencimiento adelantado vencido)",
      subtitle: `${c} pólizas (pasó el vencimiento visible pero no el real)`,
      items,
    });
  };

  const fetchStatusItems = async (statusValue) => {
    const key = String(statusValue || "unknown");

    setStatusItemsCache((prev) => ({
      ...prev,
      [key]: { items: prev?.[key]?.items || [], loading: true, error: "" },
    }));

    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("page_size", "500");
      params.set("status", key);

      const { data } = await api.get(`/admin/policies/policies/?${params.toString()}`);
      const items = (data?.results || [])
        .filter((p) => p?.id && p?.number)
        .map((p) => ({ id: p.id, number: p.number }));

      setStatusItemsCache((prev) => ({
        ...prev,
        [key]: { items, loading: false, error: "" },
      }));

      return items;
    } catch (e) {
      setStatusItemsCache((prev) => ({
        ...prev,
        [key]: {
          items: [],
          loading: false,
          error: "No se pudo cargar el listado para este estado.",
        },
      }));
      return null;
    }
  };

  const onClickStatusCard = async (statusValue, statusCount, labelText) => {
    const key = String(statusValue || "unknown");
    const label = labelText || statusLabel(key);
    const cached = statusItemsCache?.[key];

    if (cached?.items?.length) {
      openList({
        title: `Pólizas en estado: ${label}`,
        subtitle: `${statusCount ?? cached.items.length} pólizas`,
        items: cached.items,
      });
      return;
    }

    openList({
      title: `Pólizas en estado: ${label}`,
      subtitle: `${Number(statusCount || 0)} pólizas`,
      items: [],
      loading: true,
      error: "",
    });

    const items = await fetchStatusItems(key);
    if (!items) {
      setListModalLoading(false);
      setListModalError("No se pudo cargar el listado para este estado.");
      return;
    }

    setListModalLoading(false);
    setListModalItems(items);
  };

  const statusCards = useMemo(() => {
    const raw = stats?.by_status;

    if (Array.isArray(raw)) {
      return raw
        .map((it) => {
          const status = it?.status ?? "unknown";
          return {
            status,
            label: statusLabel(status),
            count: Number(it?.count || 0),
          };
        })
        .filter((it) => it.count > 0);
    }

    if (raw && typeof raw === "object") {
      return Object.entries(raw)
        .map(([status, c]) => {
          const value = status || "unknown";
          return {
            status: value,
            label: statusLabel(value),
            count: Number(c || 0),
          };
        })
        .filter((it) => it.count > 0);
    }

    const acc = {};
    for (const p of list || []) {
      const k = p?.status || "unknown";
      acc[k] = (acc[k] || 0) + 1;
    }

    return Object.entries(acc)
      .map(([status, c]) => ({
        status,
        label: statusLabel(status),
        count: c,
      }))
      .filter((it) => it.count > 0);
  }, [stats, list]);

  // ✅ Paginación (clave del fix):
  // - "Anterior" habilitado si page>1 (o previous por si querés)
  // - "Siguiente" SOLO si existe "next" (lo manda DRF); evita 404 y evita que suba el contador sin datos
  const canGoPrev = !loadingList && (page > 1 || Boolean(previous));
  const canGoNext = useMemo(() => {
    if (loadingList) return false;
    if (next !== null && next !== undefined) return Boolean(next);
    // fallback si por algún motivo no viene next (no debería con DRF)
    return Array.isArray(list) && list.length > 0;
  }, [loadingList, next, list]);

  // opcional: mostrar "Página X / Y"
  const totalPages = useMemo(() => {
    const pageSize = 10; // backend DefaultPageNumberPagination.page_size
    const total = Number(count || 0);
    return Math.max(1, Math.ceil(total / pageSize));
  }, [count]);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Pólizas</h1>
        </div>

        <div className="admin-actions">
          <button
            className="btn-secondary"
            type="button"
            onClick={onRefresh}
            disabled={loadingList}
          >
            {loadingList ? "Actualizando…" : "Actualizar"}
          </button>

          <button
            className="btn-primary"
            type="button"
            onClick={() => setOpenCreate(true)}
            disabled={!isAdmin}
            title={!isAdmin ? "Necesitás permisos de administrador." : ""}
          >
            + Crear póliza
          </button>
        </div>
      </div>

      {errorList ? <div className="admin-alert">{String(errorList)}</div> : null}

      {editErr ? <div className="admin-alert">{String(editErr)}</div> : null}
      {statsErr ? <div className="admin-alert">{String(statsErr)}</div> : null}

      <div className="admin-metrics">
        <button
          type="button"
          className="metric-card"
          onClick={onClickAdjustmentCard}
          disabled={loadingStats || !stats}
          title="Ver pólizas en período de ajuste"
          style={{ cursor: loadingStats || !stats ? "not-allowed" : "pointer" }}
        >
          <div className="metric-label">En ajuste</div>
          <div className="metric-value">
            {loadingStats ? "…" : Number(stats?.adjustment?.count || 0)}
          </div>
        </button>

        <button
          type="button"
          className="metric-card"
          onClick={onClickSoftOverdueCard}
          disabled={loadingStats || !stats}
          title="Ver pólizas no abonadas con vencimiento visible vencido"
          style={{ cursor: loadingStats || !stats ? "not-allowed" : "pointer" }}
        >
          <div className="metric-label">No abonadas</div>
          <div className="metric-value">
            {loadingStats ? "…" : Number(stats?.soft_overdue_unpaid?.count || 0)}
          </div>
        </button>

        {statusCards.map((it) => (
          <button
            key={it.status}
            type="button"
            className="metric-card"
            onClick={() => onClickStatusCard(it.status, it.count, it.label)}
            disabled={loadingStats || (!stats && !list?.length)}
            title={`Ver pólizas en estado ${it.label}`}
            style={{
              cursor: loadingStats || (!stats && !list?.length) ? "not-allowed" : "pointer",
            }}
          >
            <div className="metric-label">{it.label}</div>
            <div className="metric-value">{loadingStats ? "…" : it.count}</div>
          </button>
        ))}
      </div>

      <div className="table-card" style={{ marginTop: 18, marginBottom: 14 }}>
        <div className="table-head">
          <div className="table-title">Búsqueda</div>
          <div className="table-muted">Total: {count}</div>
        </div>

        <div style={{ padding: 14, display: "flex", gap: 10 }}>
          <input
            className="form-input"
            value={q}
            onChange={(e) => dispatch(setAdminPoliciesQuery(e.target.value))}
            placeholder="Buscar por número o patente…"
            disabled={!isAdmin}
          />
        </div>
      </div>

      <PoliciesTable
        policies={list}
        loading={loadingList}
        onEdit={onEdit}
        onDelete={onDelete}
        deleting={loadingDelete}
      />

      <div className="admin-pagination">
        <button
          className="btn-secondary"
          type="button"
          disabled={!canGoPrev}
          onClick={() => dispatch(setAdminPoliciesPage(Math.max(1, page - 1)))}
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
          onClick={() => dispatch(setAdminPoliciesPage(page + 1))}
        >
          Siguiente
        </button>
      </div>

      {/* ELIMINADAS */}
      <div style={{ marginTop: 14 }}>
        <button className="btn-secondary" type="button" onClick={onToggleDeleted} disabled={loadingList}>
          {showDeleted ? "Ocultar eliminadas" : "Ver eliminadas"}
          {deletedCount ? ` (${deletedCount})` : ""}
        </button>

        {showDeleted ? (
          <div className="table-card" style={{ marginTop: 10 }}>
            <div className="table-head">
              <div className="table-title">Pólizas eliminadas</div>
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
                  void fetchDeleted({ page: 1, search: next });
                }}
                placeholder="Buscar eliminadas por número o patente…"
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
                    <th>Número</th>
                    <th>Producto</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Vigencia</th>
                    <th style={{ textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {loadingDeleted ? (
                    <tr>
                      <td colSpan={6} className="td-muted">
                        Cargando pólizas eliminadas…
                      </td>
                    </tr>
                  ) : deletedList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="td-muted">
                        No hay pólizas eliminadas para mostrar.
                      </td>
                    </tr>
                  ) : (
                    deletedList.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.number}</td>
                        <td>{p.product_name || "-"}</td>
                        <td className="mono">{p.premium}</td>
                        <td>
                          <span className={`badge ${p.status || "unknown"}`}>
                            {statusLabel(p.status)}
                          </span>
                        </td>
                        <td className="mono">{fmtRange(p.start_date, p.end_date)}</td>
                        <td style={{ textAlign: "right" }}>
                          <div className="row-actions">
                            <button className="btn-link" type="button" onClick={() => onRestore(p)} disabled={loadingDeleted}>
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

      <PolicyFormModal open={openCreate} onClose={() => setOpenCreate(false)} />

      {loadingEdit ? (
        <div className="admin-alert" style={{ marginTop: 12 }}>
          Cargando detalle para editar…
        </div>
      ) : null}

      <PolicyFormModal open={!!editing} onClose={onCloseEdit} policy={editing} />

      <ListModal
        open={listModalOpen}
        title={listModalTitle}
        subtitle={listModalSubtitle}
        items={listModalItems}
        loading={listModalLoading}
        error={listModalError}
        onPick={onPickFromList}
        onClose={closeList}
      />

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
                  Pólizas
                </div>
              </div>
              <button className="modal-x" onClick={closeConfirm} disabled={confirmBusy}>
                ✕
              </button>
            </div>

            <div className="form modal-body" style={{ padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                {confirm.mode === "delete"
                  ? "¿Eliminar esta póliza?"
                  : "¿Recuperar esta póliza?"}
              </div>

              <div className="rcpt-muted" style={{ padding: 0, fontSize: 12 }}>
                {confirm.policy?.number
                  ? `Póliza: ${confirm.policy.number}`
                  : confirm.policy?.id
                  ? `ID: ${confirm.policy.id}`
                  : ""}
              </div>

              {confirm.mode === "delete" ? (
                <div className="rcpt-muted" style={{ padding: "8px 0 0", fontSize: 12 }}>
                  {(() => {
                    const assigned = userLabel(
                      confirm.policy?.user || confirm.policy?.user_obj || null
                    );
                    if (assigned) {
                      return `Cliente asignado: ${assigned}. Si confirmás, se desvinculará la relación entre la póliza y el cliente.`;
                    }
                    return "Si confirmás, la póliza quedará eliminada y no estará disponible para asignarla a un usuario.";
                  })()}
                </div>
              ) : (
                <div className="rcpt-muted" style={{ padding: "8px 0 0", fontSize: 12 }}>
                  La póliza volverá a estar disponible para asignarla a un usuario.
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
