import { useEffect, useMemo, useState } from "react";
import { listAdminPolicies, listAdminUsers, patchAdminUser, createAdminUser, patchAdminPolicy } from "@/services";
import GearIcon from "./GearIcon";

export default function Users() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [compact, setCompact] = useState(false);
  const statusClass = (s) => (s ? `status--${s}` : "status--default");
  const [statusFilter, setStatusFilter] = useState("");

  const [manageModal, setManageModal] = useState({ open: false, row: null, draft: null, saving: false });
  const [removedPolicies, setRemovedPolicies] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [inlineDraft, setInlineDraft] = useState(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, row: null, loading: false });
  const [manualPoliciesInput, setManualPoliciesInput] = useState("");
  const [inlinePoliciesInput, setInlinePoliciesInput] = useState("");
  const [inlinePolicySaving, setInlinePolicySaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // pólizas disponibles
  const [availablePolicies, setAvailablePolicies] = useState([]);
  const allowedPolicies = useMemo(
    () => availablePolicies.filter((p) => !p.user_id),
    [availablePolicies]
  );
  const userPolicyIds = useMemo(() => {
    const userId = manageModal.row?.id;
    if (!userId) return [];
    return availablePolicies
      .filter((p) => Number(p.user_id) === Number(userId))
      .map((p) => Number(p.id))
      .filter(Number.isFinite);
  }, [availablePolicies, manageModal.row?.id]);
  const assignedIds = useMemo(() => {
    const ids = new Set((manageModal.draft?.policies || []).map((n) => Number(n)).filter(Number.isFinite));
    userPolicyIds.forEach((id) => ids.add(id));
    removedPolicies.forEach((id) => ids.delete(Number(id)));
    return ids;
  }, [manageModal.draft?.policies, userPolicyIds, removedPolicies]);
  const deleteConfirmPolicies = useMemo(() => {
    const userId = deleteConfirm.row?.id;
    if (!userId) return [];
    return availablePolicies.filter((p) => Number(p.user_id) === Number(userId));
  }, [deleteConfirm.row?.id, availablePolicies]);
  const inlineUserPolicies = useMemo(() => {
    if (!expandedUserId) return [];
    return availablePolicies.filter((p) => Number(p.user_id) === Number(expandedUserId));
  }, [expandedUserId, availablePolicies]);
  const manualSuggestions = useMemo(() => {
    const term = manualPoliciesInput.trim().toLowerCase();
    if (!term) return [];
    return allowedPolicies
      .filter((p) => {
        if (assignedIds.has(Number(p.id))) return false;
        const parts = [
          p.number,
          p.vehicle?.plate,
          p.id ? String(p.id) : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return parts.includes(term);
      })
      .slice(0, 5);
  }, [allowedPolicies, manualPoliciesInput, assignedIds]);
  const inlineSuggestions = useMemo(() => {
    const term = inlinePoliciesInput.trim().toLowerCase();
    if (!term || !expandedUserId) return [];
    const assignedSet = new Set(inlineUserPolicies.map((p) => Number(p.id)));
    return allowedPolicies
      .filter((p) => !assignedSet.has(Number(p.id)))
      .filter((p) => {
        const parts = [
          p.number,
          p.vehicle?.plate,
          p.id ? String(p.id) : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return parts.includes(term);
      })
      .slice(0, 5);
  }, [allowedPolicies, inlinePoliciesInput, inlineUserPolicies, expandedUserId]);
  const assignedPolicies = useMemo(() => {
    return Array.from(assignedIds).map((id) => {
      const match = availablePolicies.find((p) => Number(p.id) === Number(id));
      return match || { id, number: id, vehicle: {} };
    });
  }, [assignedIds, availablePolicies]);

  async function fetchUsers() {
    setLoading(true);
    setErr("");
    try {
      const list = await fetchAllUsers();
      const arr = list.map((u) => ({
        ...u,
        status: u.is_active === false ? "deleted" : (u.status || "active"),
        raw_status: u.is_active === false ? "deleted" : (u.status || "active"),
      }));
      setRows(arr);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No se pudieron cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchPoliciesList() {
    try {
      const { data } = await listAdminPolicies({ params: { page: 1, page_size: 200 } });
      const arr = data?.results || data || [];
      setAvailablePolicies(arr);
    } catch {
      setAvailablePolicies([]);
    }
  }

  useEffect(() => {
    fetchUsers();
    fetchPoliciesList();
  }, []);

  async function fetchAllUsers() {
    const pageSize = 200;
    let page = 1;
    const result = [];
    while (true) {
      const { data } = await listAdminUsers({
        params: { page, page_size: pageSize },
      });
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];
      if (!list.length) break;
      result.push(...list);
      if (!data?.next && !Array.isArray(data)) break;
      if (list.length < pageSize) break;
      page += 1;
    }
    return result;
  }

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const handler = (e) => setCompact(e.matches);
    handler(mq);
    mq.addEventListener ? mq.addEventListener("change", handler) : mq.addListener(handler);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", handler) : mq.removeListener(handler);
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [q, rows.length]);

  const deriveUserStatus = (user) => {
    if (!user?.id) return user?.status || "inactive";
    const mine = availablePolicies.filter((p) => Number(p.user_id) === Number(user.id));
    if (!mine.length) return "inactive";
    return mine.some((p) => p.status === "active") ? "active" : "inactive";
  };

  const usersWithStatus = useMemo(
    () =>
      rows.map((u) => {
        const rawStatus = u.status || "active";
        const derived = rawStatus === "deleted" ? "deleted" : deriveUserStatus(u);
        return { ...u, raw_status: rawStatus, status: derived, derived_status: derived };
      }),
    [rows, availablePolicies]
  );

  function openManage(row) {
    const currentUserPolicies = availablePolicies
      .filter((p) => Number(p.user_id) === Number(row.id))
      .map((p) => Number(p.id))
      .filter(Number.isFinite);
    setManageModal({
      open: true,
      row,
      draft: {
        status: row.status || "active",
        email: row.email || "",
        dni: row.dni || "",
        first_name: row.first_name || "",
        last_name: row.last_name || "",
        dob: row.dob || "",
        phone: row.phone || "",
        policies: Array.isArray(row.policies)
          ? row.policies.map((p) => p.id || p)
          : currentUserPolicies,
      },
      saving: false,
    });
    setManualPoliciesInput("");
    setRemovedPolicies([]);
  }

  function closeManage() {
    setManageModal({ open: false, row: null, draft: null, saving: false });
    setRemovedPolicies([]);
  }

  function updateManage(field, value) {
    setManageModal((m) => ({ ...m, draft: { ...m.draft, [field]: value } }));
  }

  function openInline(row) {
    if (expandedUserId === row.id) {
      setExpandedUserId(null);
      setInlineDraft(null);
      return;
    }
    setExpandedUserId(row.id);
    setInlineDraft({
      id: row.id,
      status: row.status || "active",
      email: row.email || "",
      dni: row.dni || "",
      first_name: row.first_name || "",
      last_name: row.last_name || "",
      dob: row.dob || "",
      phone: row.phone || "",
    });
    setInlinePoliciesInput("");
  }

  function updateInline(field, value) {
    setInlineDraft((d) => (d ? { ...d, [field]: value } : d));
  }

  function removePolicyFromDraft(id) {
    setManageModal((m) => {
      if (!m.draft) return m;
      const filtered = (m.draft.policies || []).filter((p) => Number(p) !== Number(id));
      return { ...m, draft: { ...m.draft, policies: filtered } };
    });
    setRemovedPolicies((prev) => Array.from(new Set([...prev, Number(id)])));
  }

  async function saveInline() {
    if (!inlineDraft?.id) return;
    setInlineSaving(true);
    setSuccessMsg("");
    try {
      const payload = {};
      if (inlineDraft.email) payload.email = inlineDraft.email;
      if (inlineDraft.dni) payload.dni = inlineDraft.dni;
      if (inlineDraft.first_name) payload.first_name = inlineDraft.first_name;
      if (inlineDraft.last_name) payload.last_name = inlineDraft.last_name;
      if (inlineDraft.dob) payload.birth_date = inlineDraft.dob;
      if (inlineDraft.phone) payload.phone = inlineDraft.phone;
      await patchAdminUser(inlineDraft.id, payload, { params: { partial: true } });
      await fetchUsers();
      setExpandedUserId(null);
      setInlineDraft(null);
      setSuccessMsg("Usuario actualizado.");
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo guardar el usuario.");
    } finally {
      setInlineSaving(false);
    }
  }

  async function deleteInline(id) {
    if (!id) return;
    setInlineSaving(true);
    try {
      await patchAdminUser(id, { is_active: false });
      await fetchUsers();
      setExpandedUserId(null);
      setInlineDraft(null);
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo eliminar.");
    } finally {
      setInlineSaving(false);
    }
  }

  async function attachPolicyInline(policyId) {
    if (!policyId || !expandedUserId) return;
    setInlinePolicySaving(true);
    try {
      await patchAdminPolicy(policyId, { user_id: expandedUserId });
      await fetchUsers();
      await fetchPoliciesList();
      setInlinePoliciesInput("");
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo asignar la póliza.");
    } finally {
      setInlinePolicySaving(false);
    }
  }

  async function detachPolicyInline(policyId) {
    if (!policyId) return;
    setInlinePolicySaving(true);
    try {
      await patchAdminPolicy(policyId, { user_id: null });
      await fetchUsers();
      await fetchPoliciesList();
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo quitar la póliza.");
    } finally {
      setInlinePolicySaving(false);
    }
  }

  async function saveManage() {
    if (!manageModal.draft || !manageModal.row) return;
    setManageModal((m) => ({ ...m, saving: true }));
    setSuccessMsg("");
    try {
      const draftIds = (manageModal.draft.policies || []).map((p) => Number(p)).filter(Number.isFinite);
      const baseIds = new Set([...draftIds, ...userPolicyIds]);
      const userId = manageModal.row.id;
      const allowedSet = new Set(
        [
          ...allowedPolicies.map((p) => Number(p.id)).filter(Number.isFinite),
          ...userPolicyIds,
        ]
      );
      const filteredPolicyIds = Array.from(baseIds)
        .filter((id) => allowedSet.has(id))
        .filter((id) => !removedPolicies.includes(id));
      const payload = {};
      if (manageModal.draft.email) payload.email = manageModal.draft.email;
      if (manageModal.draft.dni) payload.dni = manageModal.draft.dni;
      if (manageModal.draft.first_name) payload.first_name = manageModal.draft.first_name;
      if (manageModal.draft.last_name) payload.last_name = manageModal.draft.last_name;
      if (manageModal.draft.dob) payload.birth_date = manageModal.draft.dob;
      if (manageModal.draft.phone) payload.phone = manageModal.draft.phone;
      payload.policy_ids = filteredPolicyIds;
      if (manageModal.row.id) {
      await patchAdminUser(manageModal.row.id, payload);
    } else {
      await createAdminUser(payload);
    }
      await fetchUsers();
      await fetchPoliciesList();
      closeManage();
      setSuccessMsg("Usuario guardado.");
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo guardar el usuario.");
      setManageModal((m) => ({ ...m, saving: false }));
    }
  }

  useEffect(() => {
    if (!successMsg) return undefined;
    const timeout = setTimeout(() => setSuccessMsg(""), 2000);
    return () => clearTimeout(timeout);
  }, [successMsg]);

  function askDeleteUser(row) {
    setDeleteConfirm({ open: true, row, loading: false });
  }

  async function confirmDeleteUser() {
    if (!deleteConfirm.row) return;
    setDeleteConfirm((s) => ({ ...s, loading: true }));
    try {
      const userId = deleteConfirm.row.id;
      await patchAdminUser(userId, { is_active: false });
      const policiesToDetach = availablePolicies.filter((p) => Number(p.user_id) === Number(userId));
      if (policiesToDetach.length > 0) {
        await Promise.all(
          policiesToDetach.map((p) => patchAdminPolicy(p.id, { user_id: null }))
        );
      }
      await fetchUsers();
      await fetchPoliciesList();
      setDeleteConfirm({ open: false, row: null, loading: false });
      if (manageModal.row?.id === userId) closeManage();
      if (expandedUserId === userId) {
        setExpandedUserId(null);
        setInlineDraft(null);
      }
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo eliminar.");
      setDeleteConfirm((s) => ({ ...s, loading: false }));
    }
  }

  function closeDeleteConfirm() {
    if (deleteConfirm.loading) return;
    setDeleteConfirm({ open: false, row: null, loading: false });
  }

  async function restoreUser(id) {
    try {
      await patchAdminUser(id, { is_active: true });
      await fetchUsers();
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo recuperar el usuario.");
    }
  }

  const { activeUsers, archivedUsers } = useMemo(() => {
    const term = q.trim().toLowerCase();
    const matchTerm = (r) => {
      const name = `${r.first_name || ""} ${r.last_name || ""}`.toLowerCase();
      return (
        !term ||
        r.email?.toLowerCase().includes(term) ||
        (r.dni || "").toString().toLowerCase().includes(term) ||
        name.includes(term)
      );
    };
    const actives = usersWithStatus.filter((r) => {
      if (r.status === "deleted") return false;
      const matchesTerm = matchTerm(r);
      const matchesStatus = !statusFilter || r.status === statusFilter;
      return matchesTerm && matchesStatus;
    });
    const archived = usersWithStatus.filter((r) => r.status === "deleted" && matchTerm(r));
    return { activeUsers: actives, archivedUsers: archived };
  }, [usersWithStatus, q, statusFilter]);
  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((activeUsers.length || 1) / PAGE_SIZE)),
    [activeUsers.length]
  );
  const paginatedActive = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return activeUsers.slice(start, start + PAGE_SIZE);
  }, [activeUsers, page]);

  return (
    <section className="section container policies-page users-page">
      <header className="admin__head">
        <div>
          <h1>Usuarios</h1>
        </div>
      </header>

      <div className="card-like">

        {err && <div className="register-alert mb-8">{err}</div>}
        {successMsg && <div className="register-alert alert--success mb-8">{successMsg}</div>}

        <div className="pagination pagination--enhanced">
          <select
            className="status-filter"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
          <input
            className="admin__search"
            placeholder="Buscar por email, DNI o nombre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="pagination__controls">
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Anterior
            </button>
            <span className="muted">Página {page} de {pageCount}</span>
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
              Siguiente
            </button>
          </div>
        </div>
        {!compact && (
          <div className="table-wrap">
            <table className="table policies-table">
              <thead><tr>
                <th>Email</th><th>DNI</th><th>Nombre</th><th>Estado</th><th>Fecha nac.</th><th>Teléfono</th><th className="actions-col" aria-label="Acciones"></th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7}>Cargando…</td></tr>
                ) : activeUsers.length === 0 ? (
                  <tr><td colSpan={7}>Sin resultados.</td></tr>
                ) : paginatedActive.map(r => (
                  <tr key={r.id}>
                    <td>{r.email}</td>
                    <td>{r.dni || "—"}</td>
                    <td>{`${r.first_name || ""} ${r.last_name || ""}`.trim() || "—"}</td>
                    <td>
                      <span className={`badge badge--status ${statusClass(r.status)}`}>
                        {r.status || "—"}
                      </span>
                    </td>
                    <td>{r.dob || "—"}</td>
                    <td>{r.phone || "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn--outline btn--icon-only" onClick={() => openManage(r)} aria-label="Gestionar usuario">
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
        {compact && !loading && activeUsers.length > 0 && (
          <div className="compact-list">
            {paginatedActive.map((r) => (
              <div className="compact-item" key={r.id}>
                <div className="compact-main">
                  <div className="compact-text">
                    <div className="compact-title-row">
                      <p className="compact-title">{r.email}</p>
                      <span className={`badge badge--status ${statusClass(r.status)}`}>
                        {r.status || "—"}
                      </span>
                    </div>
                    <p className="compact-sub">
                      {`${r.first_name || ""} ${r.last_name || ""}`.trim() || "Sin nombre"}
                    </p>
                  </div>
                  <button className="compact-toggle" onClick={() => openInline(r)} aria-label="Gestionar">
                    {expandedUserId === r.id ? "–" : "+"}
                  </button>
                </div>
                {expandedUserId === r.id && inlineDraft && (
                  <div className="compact-details">
                    <div className="detail-row">
                      <div className="detail-label">Email</div>
                      <input className="detail-input" value={inlineDraft.email} onChange={(e)=>updateInline("email", e.target.value)} />
                    </div>
                    <div className="detail-row">
                      <div className="detail-label">DNI</div>
                      <input className="detail-input" value={inlineDraft.dni} onChange={(e)=>updateInline("dni", e.target.value)} />
                    </div>
                    <div className="detail-row">
                      <div className="detail-label">Nombre</div>
                      <input className="detail-input" value={inlineDraft.first_name} onChange={(e)=>updateInline("first_name", e.target.value)} />
                    </div>
                    <div className="detail-row">
                      <div className="detail-label">Apellido</div>
                      <input className="detail-input" value={inlineDraft.last_name} onChange={(e)=>updateInline("last_name", e.target.value)} />
                    </div>
                    <div className="detail-row">
                      <div className="detail-label">Fecha nac.</div>
                      <input className="detail-input" type="date" value={inlineDraft.dob} onChange={(e)=>updateInline("dob", e.target.value)} />
                    </div>
                    <div className="detail-row">
                      <div className="detail-label">Teléfono</div>
                      <input className="detail-input" value={inlineDraft.phone} onChange={(e)=>updateInline("phone", e.target.value)} />
                    </div>
                    <div className="detail-row">
                      <div className="detail-label">Pólizas</div>
                      {inlineUserPolicies.length === 0 && <p className="muted m-0">Sin pólizas asignadas.</p>}
                      {inlineUserPolicies.length > 0 && (
                        <div className="detail-value policy-chips">
                          {inlineUserPolicies.map((p) => (
                            <span key={`inline-pol-${p.id}`} className="policy-chip">
                              <span className="policy-chip__text">
                                {p.number || `#${p.id}`} {p.vehicle?.plate ? `— ${p.vehicle.plate}` : ""}
                              </span>
                              <button
                                type="button"
                                className="btn btn--icon policy-chip__remove"
                                onClick={() => detachPolicyInline(p.id)}
                                disabled={inlinePolicySaving}
                                aria-label={`Quitar póliza ${p.number || p.id}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="detail-row">
                      <div className="detail-label">Agregar póliza</div>
                      <input
                        className="detail-input"
                        placeholder="Número o patente"
                        value={inlinePoliciesInput}
                        onChange={(e) => setInlinePoliciesInput(e.target.value)}
                      />
                      <small className="muted">Solo aparecen pólizas sin usuario asignado.</small>
                      {inlineSuggestions.length > 0 && (
                        <div className="compact-details compact-details--tight">
                          <div className="detail-list detail-list--flat">
                            {inlineSuggestions.map((p) => (
                              <div key={`inline-sugg-${p.id}`} className="detail-row detail-row--compact">
                                <div className="detail-label">#{p.number || p.id}</div>
                                <div className="detail-value detail-inline detail-inline--compact">
                                  <span className="muted">{p.vehicle?.plate || "—"}</span>
                                  <button
                                    className="btn btn--subtle"
                                    type="button"
                                    onClick={() => attachPolicyInline(p.id)}
                                    disabled={inlinePolicySaving}
                                  >
                                    Agregar
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="compact-actions-inline">
                      <button className="btn btn--danger" onClick={() => askDeleteUser(r)} disabled={inlineSaving}>Eliminar</button>
                      <button className="btn btn--primary" onClick={saveInline} disabled={inlineSaving}>Guardar cambios</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {compact && !loading && activeUsers.length === 0 && (
          <p className="muted">Sin resultados.</p>
        )}
        <div className={`pagination pagination--enhanced ${compact ? "pagination--center" : "pagination--end"}`}>
          <div className={`pagination__controls ${compact ? "pagination__controls--center" : ""}`}>
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Anterior
            </button>
            <span className="muted">Página {page} de {pageCount}</span>
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
              Siguiente
            </button>
          </div>
        </div>
      </div>

      <div className="card-like recovery-card">
        <div className="admin__head admin__head--tight">
          <div className="recovery-head">
            <h3 className="heading-tight m-0">Usuarios eliminados</h3>
          </div>
          <button type="button" className="btn btn--subtle" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Ocultar" : "Ver lista"}
          </button>
        </div>
        {showArchived && (
          archivedUsers.length === 0 ? (
            <p className="muted">No hay usuarios inactivos.</p>
          ) : (
            <div className="table-wrap">
              <table className="table policies-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>DNI</th>
                    <th>Nombre</th>
                    <th>Estado</th>
                    <th>Teléfono</th>
                    <th className="actions-col" aria-label="Acciones"></th>
                  </tr>
                </thead>
                <tbody>
                  {archivedUsers.map((u) => (
                    <tr key={`arch-user-${u.id}`}>
                      <td>{u.email}</td>
                      <td>{u.dni || "—"}</td>
                      <td>{`${u.first_name || ""} ${u.last_name || ""}`.trim() || "—"}</td>
                      <td>
                        <span className={`badge badge--status ${statusClass(u.status)}`}>
                          {u.status || "—"}
                        </span>
                      </td>
                      <td>{u.phone || "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn--outline" onClick={() => restoreUser(u.id)}>Recuperar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Modal gestionar usuario */}
      {manageModal.open && manageModal.draft && (
        <div className="drawer drawer--modal">
          <div className="drawer__panel manage-modal">
            <div className="drawer__head">
              <h2>Gestionar usuario</h2>
              <button className="drawer__close" aria-label="Cerrar" onClick={closeManage}>&times;</button>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <div className="detail-label">Email</div>
                <input className="detail-input" type="email" value={manageModal.draft.email} onChange={(e)=>updateManage("email", e.target.value)} />
              </div>
              <div className="detail-row">
                <div className="detail-label">DNI</div>
                <input className="detail-input" value={manageModal.draft.dni} onChange={(e)=>updateManage("dni", e.target.value)} />
              </div>
              <div className="detail-row">
                <div className="detail-label">Nombre</div>
                <input className="detail-input" value={manageModal.draft.first_name} onChange={(e)=>updateManage("first_name", e.target.value)} />
              </div>
              <div className="detail-row">
                <div className="detail-label">Apellido</div>
                <input className="detail-input" value={manageModal.draft.last_name} onChange={(e)=>updateManage("last_name", e.target.value)} />
              </div>
              <div className="detail-row">
                <div className="detail-label">Fecha nac.</div>
                <input className="detail-input" type="date" value={manageModal.draft.dob} onChange={(e)=>updateManage("dob", e.target.value)} />
              </div>
              <div className="detail-row">
                <div className="detail-label">Teléfono</div>
                <input className="detail-input" value={manageModal.draft.phone} onChange={(e)=>updateManage("phone", e.target.value)} />
              </div>
              <div className="detail-row">
                <div className="detail-label">Pólizas</div>
                {assignedPolicies.length === 0 && <p className="muted m-0">Sin pólizas asignadas.</p>}
                {assignedPolicies.length > 0 && (
                  <div className="detail-value policy-chips">
                    {assignedPolicies.map((p) => (
                      <span key={`assigned-${p.id}`} className="policy-chip">
                        <span className="policy-chip__text">
                          {p.number || `#${p.id}`} {p.vehicle?.plate ? `— ${p.vehicle.plate}` : ""}
                        </span>
                        <button
                          type="button"
                          className="btn btn--icon policy-chip__remove"
                          onClick={() => removePolicyFromDraft(p.id)}
                          aria-label={`Quitar póliza ${p.number || p.id}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="detail-row">
                <div className="detail-label">Agregar por número</div>
                <input
                  className="detail-input"
                  placeholder="Buscar por número o patente"
                  value={manualPoliciesInput}
                  onChange={(e) => setManualPoliciesInput(e.target.value)}
                />
                <small className="muted">Escribí número o patente; verás las pólizas sin usuario para agregar.</small>
                {manualSuggestions.length > 0 && (
                  <div className="compact-details compact-details--tight">
                    <div className="detail-list detail-list--flat">
                      {manualSuggestions.map((p) => (
                        <div key={`sugg-${p.id}`} className="detail-row detail-row--compact">
                          <div className="detail-label">#{p.number || p.id}</div>
                          <div className="detail-value detail-inline detail-inline--compact">
                            <span className="muted">{p.vehicle?.plate || "—"}</span>
                            <button
                              className="btn btn--subtle"
                              type="button"
                              onClick={() => {
                                setManageModal((m) => {
                                  const existing = new Set((m.draft?.policies || []).map((id) => Number(id)));
                                  existing.add(Number(p.id));
                                  return { ...m, draft: { ...m.draft, policies: Array.from(existing) } };
                                });
                                setManualPoliciesInput("");
                              }}
                            >
                              Agregar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="actions actions--divider actions--spread">
              {manageModal.row?.id ? (
                <button
                  className="btn btn--danger"
                  onClick={() => { askDeleteUser(manageModal.row); closeManage(); }}
                  disabled={manageModal.saving}
                >
                  Eliminar
                </button>
              ) : (
                <button className="btn btn--outline" onClick={closeManage} disabled={manageModal.saving}>Cancelar</button>
              )}
              <button className="btn btn--primary" onClick={saveManage} disabled={manageModal.saving}>
                {manageModal.saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
          <div className="drawer__scrim" onClick={closeManage} />
        </div>
      )}

      {/* Confirmación de eliminación */}
      {deleteConfirm.open && (
        <div className="modal">
          <div className="modal__panel">
            <header className="modal__header">
              <h3 className="modal__title">Eliminar usuario</h3>
              <button className="modal__close" onClick={closeDeleteConfirm} aria-label="Cerrar">
                ×
              </button>
            </header>
            <div className="modal__body">
              <p>
                ¿Seguro que querés eliminar el usuario{" "}
                <strong>{deleteConfirm.row?.email || deleteConfirm.row?.id}</strong>?
                Se marcará como inactivo y podrás recuperarlo luego.
                {deleteConfirmPolicies.length > 0 && (
                  <>
                    {" "}
                    Tiene {deleteConfirmPolicies.length} póliza(s) asignada(s); quedarán sin usuario asociado.
                  </>
                )}
              </p>
            </div>
            <footer className="modal__footer">
              <div className="actions actions--end">
                <button className="btn btn--outline" onClick={closeDeleteConfirm} disabled={deleteConfirm.loading}>
                  Cancelar
                </button>
                <button className="btn btn--danger" onClick={confirmDeleteUser} disabled={deleteConfirm.loading}>
                  {deleteConfirm.loading ? "Eliminando…" : "Eliminar"}
                </button>
              </div>
            </footer>
          </div>
          <div className="modal__scrim" onClick={closeDeleteConfirm} />
        </div>
      )}
    </section>
  );
}
