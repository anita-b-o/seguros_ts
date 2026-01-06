import { useEffect, useState } from "react";
import { listAdminInsuranceTypes, createAdminInsuranceType, patchAdminInsuranceType, deleteAdminInsuranceType } from "@/services";
import GearIcon from "./GearIcon";

export default function InsuranceTypes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [compact, setCompact] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [inlineDraft, setInlineDraft] = useState(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, row: null, loading: false });
  const [showArchived, setShowArchived] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = create
  const EMPTY = { name: "", subtitle: "", bullets: [], bulletsText: "", published_home: true };
  const [draft, setDraft] = useState(EMPTY);

  async function fetchAll() {
    setLoading(true); setErr("");
    try {
      const { data } = await listAdminInsuranceTypes();
      const list = Array.isArray(data) ? data : data?.results || [];
      setRows(list.map((r) => ({
        ...r,
        bullets: Array.isArray(r.bullets) ? r.bullets : [],
        bulletsText: Array.isArray(r.bullets) ? r.bullets.join("\n") : "",
        published_home: r.published_home !== false,
        is_active: r.is_active !== false,
        policy_count: Number.isFinite(r.policy_count) ? r.policy_count : 0,
      })));
    } catch (e) {
      setErr(e?.response?.data?.detail || "No se pudieron cargar los seguros.");
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const handler = (e) => setCompact(e.matches);
    handler(mq);
    mq.addEventListener ? mq.addEventListener("change", handler) : mq.addListener(handler);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", handler) : mq.removeListener(handler);
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY);
    setFormOpen(true);
  }
  function openEdit(row) {
    setEditing(row);
    setDraft({
      name: row.name || "",
      subtitle: row.subtitle || "",
      bullets: Array.isArray(row.bullets) ? row.bullets : [],
      bulletsText: Array.isArray(row.bullets) ? row.bullets.join("\n") : "",
      published_home: row.published_home !== false,
    });
    setFormOpen(true);
  }

  async function onSave(e) {
    e.preventDefault();
    const bullets = (draft.bulletsText ?? draft.bullets ?? "")
      .toString()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    try {
      if (editing) {
        await patchAdminInsuranceType(editing.id, {
          name: draft.name,
          subtitle: draft.subtitle,
          bullets,
          published_home: !!draft.published_home,
        });
      } else {
        await createAdminInsuranceType({
          name: draft.name,
          subtitle: draft.subtitle,
          bullets,
          published_home: !!draft.published_home,
        });
      }
      setFormOpen(false); setEditing(null);
      await fetchAll();
    } catch (e2) {
      alert(e2?.response?.data?.detail || "No se pudo guardar.");
    }
  }

  async function onDeleteInside() {
    if (!editing?.id) return;
    setDeleteConfirm({ open: true, row: editing, loading: false });
    setFormOpen(false);
  }

  function openInline(row) {
    if (expandedId === row.id) {
      setExpandedId(null);
      setInlineDraft(null);
      return;
    }
    setExpandedId(row.id);
    setInlineDraft({ id: row.id, name: row.name || "", subtitle: row.subtitle || "" });
  }

  function updateInline(field, value) {
    setInlineDraft((d) => (d ? { ...d, [field]: value } : d));
  }

  async function saveInline() {
    if (!inlineDraft?.id) return;
    setInlineSaving(true);
    try {
      await patchAdminInsuranceType(inlineDraft.id, {
        name: inlineDraft.name,
        subtitle: inlineDraft.subtitle,
      });
      await fetchAll();
      setExpandedId(null);
      setInlineDraft(null);
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo guardar.");
    } finally {
      setInlineSaving(false);
    }
  }

  async function toggleActive(row, active) {
    if (!row?.id) return;
    if (active === false) {
      setDeleteConfirm({ open: true, row, loading: false });
      return;
    }
    try {
      const payload = { is_active: !!active };
      if (active) payload.published_home = true; // al recuperar, vuelve a Home
      await patchAdminInsuranceType(row.id, payload);
      await fetchAll();
      if (!active && expandedId === row.id) {
        setExpandedId(null);
        setInlineDraft(null);
      }
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo actualizar el seguro.");
    }
  }

  const activeRows = rows.filter((r) => r.is_active !== false);
  const archivedRows = rows.filter((r) => r.is_active === false);
  const policyCountText = (row) => {
    const count = Number.isFinite(row?.policy_count) ? row.policy_count : 0;
    if (count === 0) return "No tiene pólizas asociadas.";
    const suffix = count === 1 ? "póliza asociada" : "pólizas asociadas";
    return `Tiene ${count} ${suffix}; quedarán sin seguro asociado.`;
  };

  return (
    <section className="section container policies-page">
      <header className="admin__head">
        <div>
          <h1>Seguros</h1>
        </div>
        <div className="ml-auto align-self-center">
          <button className="btn btn--primary" onClick={openCreate}>Nuevo seguro</button>
        </div>
      </header>

      {err && <div className="register-alert mt-8">{err}</div>}

      <div className="card-like">
        {compact ? (
          <div className="compact-list">
            {loading ? (
              <p className="muted">Cargando…</p>
            ) : activeRows.length === 0 ? (
              <p className="muted">Sin resultados.</p>
            ) : (
              activeRows.map((r) => {
                const isExpanded = expandedId === r.id;
                const draft = isExpanded ? inlineDraft || { id: r.id, name: r.name || "", subtitle: r.subtitle || "" } : null;
                return (
                  <div className="compact-item" key={r.id}>
                    <div className="compact-main">
                      <div className="compact-text">
                        <div className="compact-title-row">
                          <p className="compact-title">{r.name}</p>
                        </div>
                      </div>
                      <button className="compact-toggle" onClick={() => openInline(r)} aria-label="Ver detalle">
                        {isExpanded ? "–" : "+"}
                      </button>
                    </div>
                    {isExpanded && draft && (
                      <div className="compact-details">
                        <div className="detail-row">
                          <div className="detail-label">Nombre</div>
                          <input
                            className="detail-input"
                            value={draft.name}
                            onChange={(e) => updateInline("name", e.target.value)}
                          />
                        </div>
                        <div className="detail-row">
                          <div className="detail-label">Descripción</div>
                          <textarea
                            className="detail-input"
                            rows={3}
                            value={draft.subtitle}
                            onChange={(e) => updateInline("subtitle", e.target.value)}
                          />
                        </div>
                        <div className="compact-actions-inline">
                          <button className="btn btn--outline btn--icon-only" onClick={() => openEdit(r)} aria-label="Gestionar seguro">
                            <GearIcon />
                          </button>
                          <button className="btn btn--primary" onClick={saveInline} disabled={inlineSaving}>
                            {inlineSaving ? "Guardando…" : "Guardar"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table policies-table">
              <thead><tr>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Visible en Home</th>
                <th className="col-narrow"></th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4}>Cargando…</td></tr>
                ) : activeRows.length === 0 ? (
                  <tr><td colSpan={4}>Sin resultados.</td></tr>
                ) : activeRows.map(r => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.subtitle || "—"}</td>
                    <td>{r.published_home ? "Sí" : "No"}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn--outline btn--icon-only" onClick={() => openEdit(r)} aria-label="Gestionar seguro">
                        <GearIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <div className="drawer drawer--modal">
          <div className="drawer__panel manage-modal">
            <div className="drawer__head">
              <h2>{editing ? `Gestionar seguro ${editing.name || ""}` : "Nuevo seguro"}</h2>
              <button className="drawer__close" onClick={() => setFormOpen(false)} aria-label="Cerrar">&times;</button>
            </div>

            <form className="detail-list" onSubmit={onSave}>
              <div className="detail-row">
                <div className="detail-label">Nombre</div>
                <div className="detail-value">
                  <input
                    className="detail-input"
                    value={draft.name}
                    onChange={(e)=>setDraft(d=>({...d,name:e.target.value}))}
                    required
                  />
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-label">Descripción</div>
                <div className="detail-value">
                  <textarea
                    className="detail-input"
                    rows={3}
                    value={draft.subtitle}
                    onChange={(e)=>setDraft(d=>({...d,subtitle:e.target.value}))}
                  />
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-label">Características</div>
                <div className="detail-value">
                  <textarea
                    className="detail-input"
                    rows={5}
                    placeholder="Una por línea"
                    value={draft.bulletsText || ""}
                    onChange={(e)=>setDraft(d=>({
                      ...d,
                      bulletsText: e.target.value,
                    }))}
                  />
                  <small className="muted">Se muestran como bullets en el Home.</small>
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-label">Visible en Home</div>
                <div className="detail-value">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={!!draft.published_home}
                      onChange={(e)=>setDraft(d=>({...d, published_home: e.target.checked}))}
                    />
                    <span>Mostrar en la portada</span>
                  </label>
                </div>
              </div>
              <div className="actions actions--end">
                {editing?.id && (
                  <button className="btn btn--danger" type="button" onClick={onDeleteInside}>Eliminar</button>
                )}
                <button className="btn btn--primary" type="submit">Guardar</button>
              </div>
            </form>
          </div>
          <div className="drawer__scrim" onClick={()=>setFormOpen(false)} />
        </div>
      )}

      {deleteConfirm.open && (
        <div className="modal">
          <div className="modal__panel">
            <header className="modal__header">
              <h3 className="modal__title">Eliminar seguro</h3>
              <button
                className="modal__close"
                onClick={() => setDeleteConfirm({ open: false, row: null, loading: false })}
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>
            <div className="modal__body">
              <p>
                ¿Seguro que querés eliminar el seguro{" "}
                <strong>{deleteConfirm.row?.name || deleteConfirm.row?.id}</strong>?{" "}
                {policyCountText(deleteConfirm.row)} Se marcará como inactivo y podrás recuperarlo luego.
              </p>
            </div>
            <footer className="modal__footer">
              <div className="actions actions--end">
                <button
                  className="btn btn--outline"
                  onClick={() => setDeleteConfirm({ open: false, row: null, loading: false })}
                  disabled={deleteConfirm.loading}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn--danger"
                  onClick={async () => {
                    if (!deleteConfirm.row?.id) return;
                    setDeleteConfirm((s) => ({ ...s, loading: true }));
                    try {
                      await patchAdminInsuranceType(deleteConfirm.row.id, { is_active: false });
                      setDeleteConfirm({ open: false, row: null, loading: false });
                      setFormOpen(false);
                      setEditing(null);
                      await fetchAll();
                    } catch (e) {
                      alert(e?.response?.data?.detail || "No se pudo eliminar.");
                      setDeleteConfirm((s) => ({ ...s, loading: false }));
                    }
                  }}
                  disabled={deleteConfirm.loading}
                >
                  {deleteConfirm.loading ? "Eliminando…" : "Eliminar"}
                </button>
              </div>
            </footer>
          </div>
          <div
            className="modal__scrim"
            onClick={() => setDeleteConfirm({ open: false, row: null, loading: false })}
          />
        </div>
      )}

      {archivedRows.length > 0 && (
        <div className="card-like recovery-card">
          <div className="admin__head admin__head--tight">
            <div className="recovery-head">
              <h3 className="heading-tight m-0">Seguros eliminados</h3>
            </div>
            <button
              type="button"
              className="btn btn--subtle"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "Ocultar" : "Ver lista"}
            </button>
          </div>
          {showArchived && (
            <div className="table-wrap">
              <table className="table policies-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Descripción</th>
                    <th className="col-narrow"></th>
                  </tr>
                </thead>
                <tbody>
                  {archivedRows.map((r) => (
                    <tr key={`arch-${r.id}`}>
                      <td>{r.name}</td>
                      <td>{r.subtitle || "—"}</td>
                      <td>
                        <button className="btn btn--outline" onClick={() => toggleActive(r, true)}>Recuperar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
