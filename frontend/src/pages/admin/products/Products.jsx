// src/pages/admin/products/Products.jsx
import { useEffect, useMemo, useState } from "react";
import useAuth from "@/hooks/useAuth";
import { adminProductsApi } from "@/services/adminProductsApi";
import "@/styles/adminPolicies.css";

import ProductsTable from "./ProductsTable";
import ProductFormModal from "./ProductFormModal";

function fmtBool(v) {
  return v ? "Sí" : "No";
}

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

  const load = async ({ p = page, query = q } = {}) => {
    setLoading(true);
    setErr("");
    try {
      const data = await adminProductsApi.list({ page: p, page_size: pageSize, q: query });
      const items = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setList(items);
      setCount(Number(data?.count ?? items.length ?? 0));
      setPage(p);
    } catch (e) {
      setList([]);
      setCount(0);
      setErr("No se pudieron cargar los productos (tipos de seguro).");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void load({ p: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const onRefresh = () => void load({ p: 1 });

  const onSearch = () => void load({ p: 1, query: q });

  const onClearSearch = () => {
    setQ("");
    void load({ p: 1, query: "" });
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
    const ok = window.confirm(`¿Eliminar el seguro "${row?.name || row?.code || row.id}"?`);
    if (!ok) return;

    setErr("");
    try {
      await adminProductsApi.remove(row.id);
      await load({ p: Math.max(1, page) });
    } catch {
      setErr("No se pudo eliminar el producto.");
    }
  };

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil((count || 0) / pageSize));
  }, [count, pageSize]);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Productos</h1>
          <p className="admin-sub">
            Gestión de tipos de seguros. En el Home se muestran solo los que estén <b>Visibles en Home</b>.
          </p>
        </div>

        <div className="admin-actions">
          <button className="btn-secondary" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>

          <button
            className="btn-primary"
            type="button"
            onClick={() => setOpenCreate(true)}
            disabled={!isAdmin}
            title={!isAdmin ? "Necesitás permisos de administrador." : ""}
          >
            + Crear seguro
          </button>
        </div>
      </div>

      {err ? <div className="admin-alert">{String(err)}</div> : null}

      <div className="table-card" style={{ marginBottom: 14 }}>
        <div className="table-head">
          <div className="table-title">Buscar</div>
          <div className="table-muted">{loading ? "Cargando…" : `${list.length} ítems`}</div>
        </div>
        <div className="form" style={{ gap: 10 }}>
          <div className="form-label" style={{ gap: 6 }}>
            Nombre o código
            <div style={{ display: "flex", gap: 10 }}>
              <input
                className="form-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ej: RC, TR, Auto Total…"
              />
              <button className="btn-secondary" type="button" onClick={onSearch} disabled={loading}>
                Buscar
              </button>
              <button className="btn-secondary" type="button" onClick={onClearSearch} disabled={loading}>
                Limpiar
              </button>
            </div>
          </div>
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
          Página {page} / {totalPages} · Total {count} · Home visibles{" "}
          {list.filter((p) => !!p.published_home && !!p.is_active).length} (en esta página)
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
    </div>
  );
}
