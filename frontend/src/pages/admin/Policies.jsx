import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { listAdminPolicies, listAdminUsers, listAdminInsuranceTypes, getAdminSettings, patchAdminPolicy, createAdminPolicy, listPendingPayments } from "@/services";
import { fetchQuoteShare } from "@/services/quoteShare";
import GearIcon from "./GearIcon";
import { addMonths, daysUntil, visibleEndDate, paymentWindow, isPolicyExpiringAfterWindow, nextInstallment } from "./policyHelpers";

function deriveStatus(status, endDate) {
  const d = daysUntil(endDate);
  if (["cancelled", "inactive", "suspended"].includes(status)) return status;
  if (d < 0) return "expired";
  if (status === "expired") return "active";
  return status || "active";
}

function inPaymentWindow(row, prefWindowDays, dueDayDisplay) {
  const { start, end, realEnd } = paymentWindow(row, prefWindowDays, dueDayDisplay);
  const from = daysUntil(start);
  const to = daysUntil(realEnd || end);
  // Si estamos dentro de la ventana, OK
  if (Number.isFinite(from) && Number.isFinite(to) && from <= 0 && to >= 0) return true;
  // Permitir pago hasta el vencimiento real
  const real = realEnd || row?.real_end_date || row?.end_date;
  const realDiff = daysUntil(real);
  if (Number.isFinite(realDiff) && realDiff >= 0) return true;
  return false;
}

function paymentWindowStatus(row, prefWindowDays, dueDayDisplay, queuedManual = false) {
  const inWindow = inPaymentWindow(row, prefWindowDays, dueDayDisplay);
  if (queuedManual) return "Pago manual listo para registrar al guardar.";
  if (row?.has_paid_in_window) return "Pago registrado en esta ventana.";
  if (inWindow) return "Disponible para registrar pago (hasta vencimiento real).";
  return "Fuera del rango de pago.";
}

function paymentWindowLabel(row, prefWindowDays, dueDayDisplay) {
  const { start, end } = paymentWindow(row, prefWindowDays, dueDayDisplay);
  const startDay = start ? new Date(`${start}T00:00:00`).getDate() : null;
  const endDay = end ? new Date(`${end}T00:00:00`).getDate() : null;
  if (Number.isInteger(startDay) && Number.isInteger(endDay)) return `del ${startDay} al ${endDay}`;
  if (Number.isInteger(startDay)) return `desde el ${startDay}`;
  if (Number.isInteger(endDay)) return `hasta el ${endDay}`;
  return "—";
}

function realDueDay(row, fallbackDay) {
  const dateStr = row?.real_end_date || row?.end_date;
  if (!dateStr) return fallbackDay ?? null;
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d)) return fallbackDay ?? null;
  return d.getDate();
}

function sPlural(n) {
  return n === 1 ? "" : "s";
}

function inputClass(base, err) {
  return err ? `${base} input--error` : base;
}

function isValidDateStr(s) {
  if (!s) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime()) && s.length === 10;
}

function validateDraft(
  draft,
  {
    requireProduct = true,
    requireEnd = true,
    requirePremium = true,
    requireNumber = false,
  } = {}
) {
  const errors = {};
  if (requireProduct && !draft.product_id) errors.product_id = "Seleccioná un producto (ej: Plan básico).";

  if (requireNumber) {
    const numberValue = (draft.number ?? "").trim();
    if (!numberValue) errors.number = "Ingresá el número de póliza (ej: SC-1234).";
    else if (numberValue.slice(0, 3).toUpperCase() !== "SC-") {
      errors.number = "El número de póliza debe comenzar con SC-.";
    }
  }

  if (!draft.start_date || !isValidDateStr(draft.start_date)) errors.start_date = "Ingresá inicio (ej: 2025-01-15).";

  if (requireEnd || draft.end_date) {
    if (!draft.end_date || !isValidDateStr(draft.end_date)) errors.end_date = "Ingresá fin (ej: 2025-04-15).";
    const start = new Date(`${draft.start_date}T00:00:00`);
    const end = new Date(`${draft.end_date}T00:00:00`);
    if (end < start) errors.end_date = "La fecha de fin no puede ser anterior a la de inicio.";
  }

  if (requirePremium || (draft.premium !== "" && draft.premium != null)) {
    if (draft.premium === "" || draft.premium == null) errors.premium = "Ingresá un monto de cuota (ej: 15000).";
    const num = Number(draft.premium);
    if (!Number.isFinite(num) || num < 0) errors.premium = "Ingresá un monto de cuota válido.";
  }

  // Vehículo: si se carga algo, año es obligatorio y numérico
  const v = draft.vehicle || {};
  const vehicleFields = Object.values(v).some((val) => val !== "" && val !== null && val !== undefined);
  if (vehicleFields) {
    if (v.year === "" || v.year == null) errors.vehicle_year = "Ingresá el año del vehículo (ej: 2022).";
    else if (!Number.isFinite(Number(v.year))) errors.vehicle_year = "Año debe ser numérico (ej: 2022).";
  }

  return errors;
}

function displayRealDue(row, fallbackDay, offsetDays = 0) {
  const inst = nextInstallment(row);
  const realDate = inst?.due_date_real || row?.real_end_date || row?.end_date;
  const visibleDate = inst?.payment_window_end || inst?.due_date_display || row?.payment_end_date || row?.client_end_date;
  if (realDate) {
    const day = realDueDay(row, fallbackDay);
    const suffix = visibleDate && visibleDate !== realDate ? ` (visible ${visibleDate})` : "";
    return day ? `${realDate} (día ${day})${suffix}` : `${realDate}${suffix}`;
  }
  if (visibleDate) return visibleDate;
  const day = fallbackDay ?? realDueDay(row, fallbackDay);
  return day ? `día ${day}` : "—";
}

function adjustmentWindow(row) {
  const from = row?.adjustment_from || "";
  const to = row?.adjustment_to || "";
  return { from, to };
}

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const PAGE_SIZE = 10;
const EXPIRING_PAGE_SIZE = 3;
const ADJUSTMENT_PAGE_SIZE = 3;
const SECTION_MAX_PAGES = 5;
const SECTION_MAX_ITEMS = SECTION_MAX_PAGES * PAGE_SIZE;
const EXPIRING_SECTION_MAX_ITEMS = SECTION_MAX_PAGES * EXPIRING_PAGE_SIZE;
const ADJUSTMENT_SECTION_MAX_ITEMS = SECTION_MAX_PAGES * ADJUSTMENT_PAGE_SIZE;
const ADMIN_FETCH_PAGE_SIZE = 200;

function adjustmentWindowLabel(row) {
  const { from, to } = adjustmentWindow(row);
  if (!from || !to) return "—";
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = MONTHS_ES[start.getMonth()];
  const endMonth = MONTHS_ES[end.getMonth()];
  if (start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)) return `el ${endDay} de ${endMonth}`;
  return `del ${startDay} de ${startMonth} al ${endDay} de ${endMonth}`;
}

function adjustmentDaysLeft(row) {
  const target = adjustmentWindow(row)?.to || row?.end_date;
  const days = daysUntil(target);
  if (!Number.isFinite(days)) return null;
  return Math.max(days, 0);
}

async function fetchAdminPolicies({ pageSize = ADMIN_FETCH_PAGE_SIZE } = {}) {
  const all = [];
  let page = 1;
  while (true) {
    const { data } = await listAdminPolicies({
      params: { page, page_size: pageSize },
    });
    const arr = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];
    if (!arr.length && !Array.isArray(data?.results)) {
      break;
    }
    all.push(...arr);
    const isPaginated = Array.isArray(data?.results);
    if (!isPaginated || !data?.next) break;
    page += 1;
  }
  return all;
}

const INSTALLMENT_STATUS_LABEL = {
  pending: "En pago normal",
  near_due: "Próxima a vencer",
  paid: "Pagada",
  expired: "Vencida",
};

function normalizeInstallment(inst, policy) {
  const status = inst?.effective_status || inst?.status || "pending";
  const daysLeft = daysUntil(inst?.due_date_real);
  return {
    ...inst,
    __status: status,
    __daysLeftReal: Number.isFinite(daysLeft) ? daysLeft : null,
    __policy: policy,
  };
}

function currentInstallmentInfo(row) {
  const inst = nextInstallment(row);
  if (!inst) return null;
  const status = inst?.effective_status || inst?.status || "pending";
  const label = INSTALLMENT_STATUS_LABEL[status] || status;
  const due = inst?.due_date_real || inst?.due_date_display || inst?.payment_window_end;
  const badgeClass =
    {
      paid: "status--active",
      pending: "status--default",
      near_due: "status--suspended",
      expired: "status--expired",
    }[status] || "status--default";
  return { label, due, status, badgeClass };
}

function inDateWindow(startStr, endStr) {
  const startDiff = daysUntil(startStr);
  const endDiff = daysUntil(endStr);
  return Number.isFinite(startDiff) && startDiff <= 0 && (!Number.isFinite(endDiff) || endDiff >= 0);
}

function isAdjustmentDue(row) {
  if (!row || row.status !== "active") return false;
  const stillValid = daysUntil(visibleEndDate(row)) >= 0;
  const { from, to } = adjustmentWindow(row);
  return inDateWindow(from, to) && stillValid;
}

export default function Policies() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [compact, setCompact] = useState(false);
  const [paymentWindowDays, setPaymentWindowDays] = useState(null);
  const [expiringThresholdDays, setExpiringThresholdDays] = useState(30);
  const [page, setPage] = useState(1);
  const [expiringPage, setExpiringPage] = useState(1);
  const [adjustmentPage, setAdjustmentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");

  // combos
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);

  // búsqueda simple
  const [q, setQ] = useState("");

  // drawer crear/editar
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [quoteLink, setQuoteLink] = useState("");
  const [quoteLoadErr, setQuoteLoadErr] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [editingErrors, setEditingErrors] = useState({});

  // modal de gestión rápida
  const [manageModal, setManageModal] = useState({ open: false, row: null, draft: null, saving: false });
  const [manualPaying, setManualPaying] = useState(false);
  const [manualPaymentQueued, setManualPaymentQueued] = useState(false);
  const [inlinePaymentQueued, setInlinePaymentQueued] = useState(false);
  const [manageErrors, setManageErrors] = useState({});
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineErrors, setInlineErrors] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null);
  const [inlineDraft, setInlineDraft] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, row: null, loading: false });
  const [restoreConfirm, setRestoreConfirm] = useState({ open: false, row: null, loading: false });
  const [charges, setCharges] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // preferencias admin
  const [defaultTerm, setDefaultTerm] = useState(3);
  const [dueDayDisplay, setDueDayDisplay] = useState(null);
  const managePreviewRow = useMemo(() => {
    if (!manageModal.row) return null;
    if (!manageModal.draft) return manageModal.row;
    return { ...manageModal.row, ...manageModal.draft };
  }, [manageModal.row, manageModal.draft]);
  const previewRow = managePreviewRow || manageModal.row;

  async function fetchPolicies() {
    setLoading(true);
    setErr("");
    try {
      const all = await fetchAdminPolicies();
      setRows(
        all.map((r) => {
          const statusEndDate = r.real_end_date || r.end_date || visibleEndDate(r);
          return { ...r, status: deriveStatus(r.status, statusEndDate) };
        })
      );
    } catch (e) {
      setErr(e?.response?.data?.detail || "No se pudieron cargar pólizas.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsers() {
    try {
      const { data } = await listAdminUsers();
      const arr = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setUsers(arr);
    } catch {
      setUsers([]);
    }
  }

  async function fetchProducts() {
    try {
      const { data } = await listAdminInsuranceTypes();
      const arr = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setProducts(arr);
    } catch {
      setProducts([]);
    }
  }

  function queueManualPayment() {
    setManualPaymentQueued(true);
  }

  function readMaybe(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return undefined;
  }

  async function fetchSettings() {
    try {
      const { data } = await getAdminSettings();

      // soporta: {..}, {settings:{..}}, {results:[{..}]}
      const s =
        (data && data.settings) ||
        (Array.isArray(data?.results) ? data.results[0] : null) ||
        data ||
        {};

      const term = Number(readMaybe(s, ["default_term_months", "defaultTermMonths"]));
      if (Number.isFinite(term) && term > 0) setDefaultTerm(term);

      const windowDays = Number(readMaybe(s, ["payment_window_days", "paymentWindowDays"]));
      if (Number.isFinite(windowDays) && windowDays > 0) setPaymentWindowDays(windowDays);

      const displayDay = Number(readMaybe(s, ["payment_due_day_display", "paymentDueDayDisplay"]));
      if (Number.isFinite(displayDay) && displayDay > 0) setDueDayDisplay(displayDay);
      const expiringThreshold = Number(readMaybe(s, ["expiring_threshold_days", "expiringThresholdDays"]));
      if (Number.isFinite(expiringThreshold) && expiringThreshold > 0) setExpiringThresholdDays(expiringThreshold);

    } catch {
      // defaults silenciosos
    }
  }

  useEffect(() => {
    fetchPolicies();
    fetchUsers();
    fetchProducts();
    fetchSettings();

    const mq = window.matchMedia("(max-width: 900px)");
    const handler = (e) => setCompact(e.matches);
    handler(mq);
    mq.addEventListener ? mq.addEventListener("change", handler) : mq.addListener(handler);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", handler) : mq.removeListener(handler);
    };
  }, []);

  // ------- helpers visuales -------
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const fullName = [r.user?.first_name, r.user?.last_name].filter(Boolean).join(" ");
      const parts = [
        r.number,
        r.vehicle?.plate,
        r.user?.email,
        r.user?.first_name,
        r.user?.last_name,
        fullName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesTerm = !term || parts.includes(term);
      const matchesStatus = !statusFilter || r.status === statusFilter;
      return matchesTerm && matchesStatus;
    });
  }, [rows, q, statusFilter]);

  const activeFiltered = useMemo(() => filtered.filter((r) => r.status !== "inactive"), [filtered]);
  const archivedFiltered = useMemo(() => filtered.filter((r) => r.status === "inactive"), [filtered]);

  const sortedActive = useMemo(() => {
    const list = [...activeFiltered];
    list.sort((a, b) => {
      const da = new Date((a.end_date || "9999-12-31") + "T00:00:00");
      const db = new Date((b.end_date || "9999-12-31") + "T00:00:00");
      return da - db;
    });
    return list;
  }, [activeFiltered]);

  const expiring = useMemo(() => {
    const list = [];
    for (const policy of activeFiltered) {
      if (
        isPolicyExpiringAfterWindow(
          policy,
          paymentWindowDays,
          dueDayDisplay,
          expiringThresholdDays
        )
      ) {
        const realEndDiff = daysUntil(policy.real_end_date || policy.end_date);
        list.push({
          ...policy,
          __daysLeft: Number.isFinite(realEndDiff) ? Math.max(0, realEndDiff) : 0,
        });
      }
    }
    list.sort((a, b) => (a.__daysLeft ?? 9999) - (b.__daysLeft ?? 9999));
    if (process.env.NODE_ENV !== "production") {
      console.info("Expiring debug", {
        windowDays: paymentWindowDays,
        dueDayDisplay,
        thresholdDays: expiringThresholdDays,
        matches: list.map((p) => p.number || p.id),
        candidates: activeFiltered.length,
      });
    }
    return list;
  }, [activeFiltered, paymentWindowDays, dueDayDisplay, expiringThresholdDays]);

  const adjustments = useMemo(() => {
    const list = [];
    for (const p of activeFiltered) {
      if (isAdjustmentDue(p)) {
        const { from } = adjustmentWindow(p);
        list.push({ ...p, __daysToPayment: daysUntil(from || visibleEndDate(p)) });
      }
    }
    list.sort((a, b) => (a.__daysToPayment ?? 9999) - (b.__daysToPayment ?? 9999));
    return list;
  }, [activeFiltered]);

  const installments = useMemo(() => {
    const list = [];
    for (const p of rows) {
      if (!Array.isArray(p.installments)) continue;
      for (const inst of p.installments) {
        list.push(normalizeInstallment(inst, p));
      }
    }
    list.sort((a, b) => {
      const da = new Date((a.due_date_real || a.payment_window_end || "9999-12-31") + "T00:00:00");
      const db = new Date((b.due_date_real || b.payment_window_end || "9999-12-31") + "T00:00:00");
      return da - db;
    });
    return list;
  }, [rows]);

  const installmentBuckets = useMemo(() => {
    const buckets = { upToDate: [], nearDue: [], expired: [] };
    for (const inst of installments) {
      if (inst.__status === "expired") buckets.expired.push(inst);
      else if (inst.__status === "near_due") buckets.nearDue.push(inst);
      else buckets.upToDate.push(inst);
    }
    const sorter = (arr) =>
      arr.sort((a, b) => {
        const da = new Date((a.due_date_real || "9999-12-31") + "T00:00:00");
        const db = new Date((b.due_date_real || "9999-12-31") + "T00:00:00");
        return da - db;
      });
    sorter(buckets.nearDue);
    sorter(buckets.expired);
    return buckets;
  }, [installments]);

  // ---- PAGINACIÓN ----
  const normalList = sortedActive;
  const totalPages = Math.max(1, Math.ceil(normalList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = normalList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const expiringRawPages = Math.max(1, Math.ceil(expiring.length / EXPIRING_PAGE_SIZE));
  const expiringPageCount = Math.min(SECTION_MAX_PAGES, expiringRawPages);
  const safeExpiringPage = Math.min(expiringPage, expiringPageCount);
  const expiringPageRows = expiring.slice((safeExpiringPage - 1) * EXPIRING_PAGE_SIZE, safeExpiringPage * EXPIRING_PAGE_SIZE);
  const expiringHasOverflow = expiring.length > EXPIRING_SECTION_MAX_ITEMS;
  const adjustmentRawPages = Math.max(1, Math.ceil(adjustments.length / ADJUSTMENT_PAGE_SIZE));
  const adjustmentPageCount = Math.min(SECTION_MAX_PAGES, adjustmentRawPages);
  const safeAdjustmentPage = Math.min(adjustmentPage, adjustmentPageCount);
  const adjustmentPageRows = adjustments.slice((safeAdjustmentPage - 1) * ADJUSTMENT_PAGE_SIZE, safeAdjustmentPage * ADJUSTMENT_PAGE_SIZE);
  const adjustmentHasOverflow = adjustments.length > ADJUSTMENT_SECTION_MAX_ITEMS;

  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, showArchived]);

  useEffect(() => {
    setExpiringPage(1);
  }, [expiring.length]);

  useEffect(() => {
    setAdjustmentPage(1);
  }, [adjustments.length]);

  // --- CRUD/acciones (mantuve tu lógica original; acá sólo ajusté labels/ventanas) ---
  function openCreate() {
    const startDate = new Date().toISOString().slice(0, 10);
    const duration = Number(defaultTerm);
    const endDate = Number.isFinite(duration) && duration > 0 ? addMonths(startDate, duration) : "";
    setEditing({
      id: null,
      user_id: null,
      number: "",
      product_id: products?.[0]?.id ?? null,
      premium: "",
      start_date: startDate,
      end_date: endDate,
      status: "active",
      vehicle: { plate: "", make: "", model: "", version: "", year: "", city: "" },
    });
    setQuoteLink("");
    setQuoteLoadErr("");
    setDrawerOpen(true);
  }

  function openEdit(row) {
    setEditing({
      id: row.id,
      user_id: row.user?.id ?? row.user_id ?? null,
      number: row.number ?? "",
      product_id: row.product?.id ?? row.product_id ?? row.insurance_type_id ?? null,
      premium: row.premium ?? "",
      start_date: row.start_date ?? "",
      end_date: row.end_date ?? "",
      status: row.status ?? "active",
      vehicle: row.vehicle ?? { plate: "", make: "", model: "", version: "", year: "", city: "" },
    });
    setQuoteLink("");
    setQuoteLoadErr("");
    setEditingErrors({});
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditing(null);
  }

  function applyAutoEnd(prev, start) {
    const term = Number(defaultTerm);
    if (!start || !Number.isFinite(term) || term <= 0) return { ...prev, start_date: start };
    const end = addMonths(start, term);
    return { ...prev, start_date: start, end_date: end };
  }

  function handleEditingStartChange(value) {
    setEditing((prev) => applyAutoEnd(prev, value));
  }

  function openInline(row, section = "general") {
    if (expandedId === row.id && expandedSection === section) {
      setExpandedId(null);
      setExpandedSection(null);
      setInlineDraft(null);
      setInlineErrors({});
      setInlinePaymentQueued(false);
      return;
    }
    setExpandedId(row.id);
    setExpandedSection(section);
    setInlineDraft({
      id: row.id,
      user_id: row.user?.id ?? row.user_id ?? null,
      product_id: row.product?.id ?? row.product_id ?? null,
      premium: row.premium ?? "",
      start_date: row.start_date ?? "",
      end_date: row.end_date ?? "",
      status: row.status ?? "active",
      vehicle: row.vehicle ?? { plate: "", make: "", model: "", version: "", year: "", city: "" },
    });
    setInlineErrors({});
    setInlinePaymentQueued(false);
  }

  function updateInlineDraft(field, value, nestedVehicle = false) {
    setInlineDraft((d) => {
      if (!d) return d;
      if (!nestedVehicle) return { ...d, [field]: value };
      return { ...d, vehicle: { ...(d.vehicle || {}), [field]: value } };
    });
  }

  function handleInlineStartChange(value) {
    setInlineDraft((d) => applyAutoEnd(d, value, { force: false }));
  }

  async function saveInline() {
    if (!inlineDraft?.id) return;

    const errs = validateDraft(inlineDraft, { requireProduct: true, requireEnd: true, requirePremium: true });
    setInlineErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setInlineSaving(true);

    const payload = {
      user_id: inlineDraft.user_id ? Number(inlineDraft.user_id) : null,
      product_id: inlineDraft.product_id ? Number(inlineDraft.product_id) : null,
      start_date: inlineDraft.start_date || null,
      end_date: inlineDraft.end_date || null,
      status: inlineDraft.status,
    };
    if (!(inlineDraft.premium === "" || inlineDraft.premium == null)) {
      const num = Number(inlineDraft.premium);
      if (Number.isFinite(num)) payload.premium = num;
    }
    const v = inlineDraft.vehicle || {};
    const vehicleFields = Object.values(v).some((val) => val !== "" && val !== null && val !== undefined);
    if (vehicleFields) {
      const veh = { ...v };
      if (veh.year !== undefined && veh.year !== null && veh.year !== "") veh.year = Number(veh.year);
      payload.vehicle = veh;
    }

    try {
      await patchAdminPolicy(inlineDraft.id, payload);
      setExpandedId(null);
      setExpandedSection(null);
      setInlineDraft(null);
      setInlineErrors({});
      if (inlinePaymentQueued) {
        setManualPaying(true);
        try {
          await api.post(`/payments/manual/${inlineDraft.id}/`);
          setInlinePaymentQueued(false);
        } catch (e) {
          alert(e?.response?.data?.detail || "No se pudo registrar el pago manual.");
          setManualPaying(false);
          setInlineSaving(false);
          return;
        }
        setManualPaying(false);
      }
      await fetchPolicies();
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo guardar los cambios.");
    } finally {
      setInlineSaving(false);
    }
  }

  const renderInlineDetails = (row) => {
    if (!inlineDraft) return null;
    return (
      <div className="compact-details">
        <div className="detail-row">
          <div className="detail-label">Usuario</div>
          <select
            className={inputClass("detail-input", inlineErrors.user_id)}
            value={inlineDraft.user_id ?? ""}
            onChange={(e) => {
              updateInlineDraft("user_id", e.target.value ? Number(e.target.value) : null);
              setInlineErrors((er) => {
                const next = { ...er };
                delete next.user_id;
                return next;
              });
            }}
          >
            <option value="">— Sin usuario —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </div>

        <div className="detail-row">
          <div className="detail-label">Estado</div>
          <select className="detail-input" value={inlineDraft.status} onChange={(e) => updateInlineDraft("status", e.target.value)}>
            <option value="active">Activa</option>
            <option value="suspended">Suspendida</option>
            <option value="expired">Vencida</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>

        <div className="detail-row">
          <div className="detail-label">Vigencia</div>
          <div className="detail-value detail-inline detail-inline--dates">
            <input
              className={inputClass("detail-input", inlineErrors.start_date)}
              type="date"
              value={inlineDraft.start_date}
              onChange={(e) => {
                handleInlineStartChange(e.target.value);
                setInlineErrors((er) => {
                  const next = { ...er };
                  delete next.start_date;
                  return next;
                });
              }}
            />
            <input
              className={inputClass("detail-input", inlineErrors.end_date)}
              type="date"
              value={inlineDraft.end_date}
              onChange={(e) => {
                updateInlineDraft("end_date", e.target.value);
                setInlineErrors((er) => {
                  const next = { ...er };
                  delete next.end_date;
                  return next;
                });
              }}
            />
          </div>
          {(inlineErrors.start_date || inlineErrors.end_date) && (
            <small className="field-error">
              {inlineErrors.start_date || inlineErrors.end_date}
            </small>
          )}
        </div>

        <div className="detail-row">
          <div className="detail-label">Cuota</div>
          <input
            className={inputClass("detail-input", inlineErrors.premium)}
            value={inlineDraft.premium ?? ""}
            onChange={(e) => {
              updateInlineDraft("premium", e.target.value);
              setInlineErrors((er) => {
                const next = { ...er };
                delete next.premium;
                return next;
              });
            }}
          />
          {inlineErrors.premium && <small className="field-error">{inlineErrors.premium}</small>}
          {row?.id && inPaymentWindow(row, paymentWindowDays, dueDayDisplay) && (
            <div className="mt-8">
              <button
                className="btn btn--subtle"
                onClick={() => setInlinePaymentQueued(true)}
                disabled={inlinePaymentQueued || inlineSaving}
              >
                {inlinePaymentQueued ? "Se registrará al guardar" : "Marcar como pagada"}
              </button>
              {inlinePaymentQueued && (
                <div className="muted small mt-4">
                  Se registrará el pago al guardar los cambios.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="detail-row">
          <div className="detail-label">Vehículo</div>
          <div className="detail-value detail-inline vehicle-grid">
            <input className="detail-input" placeholder="Patente" value={inlineDraft.vehicle?.plate || ""} onChange={(e) => updateInlineDraft("plate", e.target.value, true)} />
            <input className="detail-input" placeholder="Marca" value={inlineDraft.vehicle?.make || ""} onChange={(e) => updateInlineDraft("make", e.target.value, true)} />
            <input className="detail-input" placeholder="Modelo" value={inlineDraft.vehicle?.model || ""} onChange={(e) => updateInlineDraft("model", e.target.value, true)} />
            <input className="detail-input" placeholder="Versión" value={inlineDraft.vehicle?.version || ""} onChange={(e) => updateInlineDraft("version", e.target.value, true)} />
            <input className={inputClass("detail-input", inlineErrors.vehicle_year)} placeholder="Año" value={inlineDraft.vehicle?.year || ""} onChange={(e) => updateInlineDraft("year", e.target.value, true)} />
            <input className="detail-input" placeholder="Ciudad" value={inlineDraft.vehicle?.city || ""} onChange={(e) => updateInlineDraft("city", e.target.value, true)} />
          </div>
          {inlineErrors.vehicle_year && <small className="field-error">{inlineErrors.vehicle_year}</small>}
        </div>

        <div className="compact-actions-inline">
          <button className="btn btn--danger" onClick={() => askDelete(row)} disabled={inlineSaving}>Eliminar</button>
          <button className="btn btn--primary" onClick={saveInline} disabled={inlineSaving}>Guardar cambios</button>
        </div>
      </div>
    );
  };

  function parseQuoteLink(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) throw new Error("Pegá el link de la cotización.");

    let hash = "";
    try {
      const url = new URL(trimmed);
      hash = url.hash?.slice(1) || "";
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "share");
      if (idx >= 0 && parts[idx + 1]) return { id: parts[idx + 1] };
    } catch {
      // no es URL, seguimos intentando
    }

    if (/^[a-zA-Z0-9]{6,}$/i.test(trimmed)) return { id: trimmed };

    if (!hash && trimmed.includes("#")) {
      const [, h] = trimmed.split("#");
      hash = h;
    }
    if (hash) return { legacyHash: decodeURIComponent(hash) };

    throw new Error("Link de cotización inválido.");
  }

  async function fillFromQuoteLink() {
    if (!editing) return;
    setQuoteLoadErr("");
    setQuoteLoading(true);
    try {
      const parsed = parseQuoteLink(quoteLink);
      let data = null;

      if (parsed.id) {
        data = await fetchQuoteShare(parsed.id);
      } else if (parsed.legacyHash) {
        const { decompressFromEncodedURIComponent } = await import("lz-string");
        const json = decompressFromEncodedURIComponent(parsed.legacyHash);
        if (!json) throw new Error("No se pudo leer la ficha del link.");
        data = JSON.parse(json);
      }

      if (!data) throw new Error("No se encontró la ficha.");

      setEditing((prev) => ({
        ...prev,
        vehicle: {
          ...prev.vehicle,
          make: data.make || "",
          model: data.model || "",
          version: data.version || "",
          year: data.year || "",
          city: data.city || "",
        },
      }));
      setQuoteLoadErr("");
    } catch (e) {
      setQuoteLoadErr(e?.response?.data?.detail || e?.message || "No se pudo leer el link.");
    } finally {
      setQuoteLoading(false);
    }
  }

  async function saveEditing() {
    if (!editing) return;

    // Validaciones front
    const errs = validateDraft(editing, {
      requireProduct: true,
      requireEnd: true,
      requirePremium: true,
      requireNumber: true,
    });
    setEditingErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const payload = {
      user_id: editing.user_id ? Number(editing.user_id) : null,
      product_id: editing.product_id ? Number(editing.product_id) : null,
      start_date: editing.start_date || null,
      end_date: editing.end_date || null,
      status: editing.status,
    };
    const trimmedNumber = (editing.number ?? "").trim();
    if (trimmedNumber) payload.number = trimmedNumber;
    if (!(editing.premium === "" || editing.premium == null)) {
      const num = Number(editing.premium);
      if (Number.isFinite(num)) payload.premium = num;
    }

    // Vehículo: solo enviar si hay datos; año obligatorio si hay algún campo
    const v = editing.vehicle || {};
    const vehicleFields = Object.values(v).some((val) => val !== "" && val !== null && val !== undefined);
    if (vehicleFields) {
      const veh = { ...v };
      if (veh.year !== undefined && veh.year !== null && veh.year !== "") veh.year = Number(veh.year);
      payload.vehicle = veh;
    }

    try {
      if (editing.id) {
        await patchAdminPolicy(editing.id, payload);
      } else {
        await createAdminPolicy(payload);
      }
      setDrawerOpen(false);
      setEditing(null);
      await fetchPolicies();
    } catch (e2) {
      alert(e2?.response?.data?.detail || "No se pudo guardar la póliza.");
    }
  }

  function handleEditingSubmit(e) {
    e.preventDefault();
    saveEditing();
  }

  function openManage(row) {
    setManualPaymentQueued(false);
    setManageModal({ open: true, row, saving: false, draft: { ...row, user_id: row.user?.id ?? row.user_id ?? null } });
    setManageErrors({});
    loadPaymentsData(row?.id);
  }

  function closeManage() {
    setManageModal({ open: false, row: null, draft: null, saving: false });
    setCharges([]);
    setReceipts([]);
    setPaymentsError("");
  }

  async function registerManualPaymentNow(policyId) {
    if (!policyId) return;
    setManualPaying(true);
    setErr("");
    try {
      await api.post(`/payments/manual/${policyId}/`);
      await fetchPolicies();
      // refrescamos modal con datos actualizados
      const refreshed = rows.find((r) => r.id === policyId);
      setManageModal((s) => ({
        ...s,
        draft: refreshed ? { ...refreshed, user_id: refreshed.user?.id ?? refreshed.user_id ?? null } : s.draft,
      }));
      await loadPaymentsData(policyId);
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo registrar el pago manual.");
    } finally {
      setManualPaying(false);
    }
  }

  async function loadPaymentsData(policyId) {
    if (!policyId) {
      setCharges([]);
      setReceipts([]);
      return;
    }
    setPaymentsLoading(true);
    setPaymentsError("");
    try {
      const [chargesRes, receiptsRes] = await Promise.all([
        listPendingPayments({ params: { policy_id: policyId } }),
        api.get(`/policies/${policyId}/receipts`),
      ]);
      const chargesPayload = Array.isArray(chargesRes.data) ? chargesRes.data : Array.isArray(chargesRes.data?.results) ? chargesRes.data.results : [];
      const receiptsPayload = Array.isArray(receiptsRes.data) ? receiptsRes.data : Array.isArray(receiptsRes.data?.results) ? receiptsRes.data.results : [];
      setCharges(chargesPayload);
      setReceipts(receiptsPayload);
    } catch (err) {
      setPaymentsError(err?.response?.data?.detail || "No se pudieron cargar cargos o recibos.");
    } finally {
      setPaymentsLoading(false);
    }
  }

  function updateManageDraft(field, value, nestedVehicle = false) {
    setManageModal((s) => {
      if (!s.draft) return s;
      if (!nestedVehicle) return { ...s, draft: { ...s.draft, [field]: value } };
      return { ...s, draft: { ...s.draft, vehicle: { ...(s.draft.vehicle || {}), [field]: value } } };
    });
  }

  function handleManageStartChange(value) {
    setManageModal((s) => {
      if (!s.draft) return s;
      const next = applyAutoEnd(s.draft, value);
      return { ...s, draft: next };
    });
  }

  async function saveManage() {
    if (!manageModal.row || !manageModal.draft) return;

    const errs = validateDraft(manageModal.draft, {
      requireProduct: !!manageModal.draft.product_id,
      requireEnd: true,
      requirePremium: true,
    });
    setManageErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setManageModal((s) => ({ ...s, saving: true }));

    try {
      // si está “queued” el pago manual, registralo junto al patch (tu backend debería procesarlo)
      // (mantuve tu comportamiento original: el “queued” sólo afecta UI aquí)
      const payload = {
        user_id: manageModal.draft.user_id ? Number(manageModal.draft.user_id) : null,
        status: manageModal.draft.status,
        start_date: manageModal.draft.start_date || null,
        end_date: manageModal.draft.end_date || null,
      };
      if (!(manageModal.draft.premium === "" || manageModal.draft.premium == null)) {
        const num = Number(manageModal.draft.premium);
        if (Number.isFinite(num)) payload.premium = num;
      }

      const v = manageModal.draft.vehicle || {};
      const vehicleFields = Object.values(v).some((val) => val !== "" && val !== null && val !== undefined);
      if (vehicleFields) {
        const veh = { ...v };
        if (veh.year !== undefined && veh.year !== null && veh.year !== "") veh.year = Number(veh.year);
        payload.vehicle = veh;
      }

      await patchAdminPolicy(manageModal.row.id, payload);
      if (manualPaymentQueued) {
        setManualPaying(true);
        try {
          await api.post(`/payments/manual/${manageModal.row.id}/`);
        } catch (e) {
          alert(e?.response?.data?.detail || "No se pudo registrar el pago manual.");
          setManualPaying(false);
          setManageModal((s) => ({ ...s, saving: false }));
          return;
        }
        setManualPaying(false);
        setManualPaymentQueued(false);
        await loadPaymentsData(manageModal.row.id);
      }
      closeManage();
      await fetchPolicies();
    } catch (e) {
      // log para depurar 400 del backend
      // eslint-disable-next-line no-console
      console.error("saveManage error", e?.response?.data || e);
      alert(e?.response?.data?.detail || "No se pudo guardar.");
      setManageModal((s) => ({ ...s, saving: false }));
    }
  }

  function askDelete(row) {
    setDeleteConfirm({ open: true, row, loading: false });
  }

  async function confirmDelete() {
    if (!deleteConfirm.row) return;
    setDeleteConfirm((s) => ({ ...s, loading: true }));
    try {
      await patchAdminPolicy(deleteConfirm.row.id, { status: "inactive", user_id: null });
      await fetchPolicies();
      if (expandedId === deleteConfirm.row.id) {
        setExpandedId(null);
        setExpandedSection(null);
        setInlineDraft(null);
      }
      setDeleteConfirm({ open: false, row: null, loading: false });
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo eliminar.");
      setDeleteConfirm((s) => ({ ...s, loading: false }));
    }
  }

  function askRestore(row) {
    setRestoreConfirm({ open: true, row, loading: false });
  }

  async function confirmRestore() {
    if (!restoreConfirm.row) return;
    setRestoreConfirm((s) => ({ ...s, loading: true }));
    try {
      await patchAdminPolicy(restoreConfirm.row.id, { status: "active" });
      await fetchPolicies();
      setRestoreConfirm({ open: false, row: null, loading: false });
    } catch (e) {
      alert(e?.response?.data?.detail || "No se pudo restaurar.");
      setRestoreConfirm((s) => ({ ...s, loading: false }));
    }
  }

  // -------------------- UI helpers --------------------
  const displayUser = (r) => {
    const u = r.user;
    if (!u) return r.user_id || "—";
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    return name || u.email || u.id || "—";
  };

  const displayProduct = (r) => r.product?.name || r.product_name || "—";
  const statusClass = (status) => `badge badge--status status--${status || "default"}`;

  const pageCount = totalPages;
  const paginatedRows = pageRows;

  // -------------------- UI --------------------
  return (
    <section className="section container policies-page">
      <header className="admin__head">
        <div>
          <h1>Pólizas</h1>
          <p className="muted small">Administrá pólizas, pagos y ajustes.</p>
        </div>
        <button className="btn btn--primary" onClick={openCreate}>
          Nueva póliza
        </button>
      </header>

      {err && <div className="alert alert--error">{err}</div>}

      {expiring.length > 0 && (
        <div className="card-like card--expiring">
          <div className="admin__head admin__head--tight">
            <h3 className="heading-tight m-0">Próximo a vencer</h3>
            <span className="muted small">Ventana cerrada, sin pago registrado.</span>
          </div>
          {compact ? (
            <div className="compact-list">
              {expiringPageRows.map((r) => (
                <div className="compact-item" key={`exp-${r.id}`}>
                  <div className="compact-main">
                    <div className="compact-text">
                      <div className="compact-title-row">
                        <p className="compact-title">{r.number || `#${r.id}`}</p>
                        <span className="countdown-chip">{r.__daysLeft} día{sPlural(r.__daysLeft)}</span>
                      </div>
                      <p className="compact-sub">{r.vehicle?.plate || "—"} · {displayUser(r)}</p>
                      <p className="muted small">
                        {r.start_date || "—"} → {visibleEndDate(r) || "—"} · Cuota ${r.premium ?? "—"}
                      </p>
                    </div>
                    <div className="row-actions">
                      <button
                        className="compact-toggle"
                        onClick={() => openInline(r, "expiring")}
                        aria-label="Gestionar"
                      >
                        {expandedId === r.id && expandedSection === "expiring" ? "–" : "+"}
                      </button>
                    </div>
                  </div>
                  {expandedSection === "expiring" && expandedId === r.id && inlineDraft && renderInlineDetails(r)}
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table policies-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Seguro</th>
                    <th>Patente</th>
                    <th>Usuario</th>
                    <th>Próximo a vencer</th>
                    <th>Vigencia</th>
                    <th>Cuota</th>
                    <th className="actions-col" aria-label="Acciones"></th>
                  </tr>
                </thead>
                <tbody>
                  {expiringPageRows.map((r) => (
                    <tr key={`exp-${r.id}`}>
                      <td>{r.number || `#${r.id}`}</td>
                      <td>{displayProduct(r)}</td>
                      <td>{r.vehicle?.plate || "—"}</td>
                      <td>{displayUser(r)}</td>
                      <td>
                        <span className="countdown-chip countdown-chip--expiring" title={`Faltan ${r.__daysLeft} día(s)`}>
                          {r.__daysLeft} día{sPlural(r.__daysLeft)}
                        </span>
                        <div className="muted small mt-2">Pago en ventana vencido</div>
                      </td>
                      <td className="small">
                        {r.start_date || "—"} → {visibleEndDate(r) || "—"}
                      </td>
                      <td>${r.premium ?? "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn--outline btn--icon-only" onClick={() => openManage(r)} aria-label="Gestionar póliza">
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
          {expiringPageCount > 1 && (
            <div className="pagination pagination--enhanced pagination--section">
              <div className="pagination__controls">
                <button
                  className="btn btn--outline"
                  onClick={() => setExpiringPage((p) => Math.max(1, p - 1))}
                  disabled={safeExpiringPage <= 1}
                >
                  Anterior
                </button>
                <span className="muted">
                  Página {safeExpiringPage} de {expiringPageCount}
                </span>
                <button
                  className="btn btn--outline"
                  onClick={() => setExpiringPage((p) => Math.min(expiringPageCount, p + 1))}
                  disabled={safeExpiringPage >= expiringPageCount}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
          {expiringHasOverflow && (
            <p className="muted small mt-8">
              Solo se muestran las primeras {EXPIRING_SECTION_MAX_ITEMS} pólizas con ventana próxima al vencimiento.
            </p>
          )}
        </div>
      )}

      {/* Período de ajuste */}
      {adjustments.length > 0 && (
        <div className="card-like card--expiring card--price-update card--adjustment">
          <div className="admin__head admin__head--tight">
            <h3 className="heading-tight m-0">En período de ajuste</h3>
            <span className="muted small">Se listan pólizas cuya ventana de ajuste ya está abierta.</span>
          </div>
          {compact ? (
            <div className="compact-list">
              {adjustmentPageRows.map((r) => (
                <div className="compact-item" key={`adj-${r.id}`}>
                  <div className="compact-main">
                    <div className="compact-text">
                      <div className="compact-title-row">
                        <p className="compact-title">{r.number || `#${r.id}`}</p>
                        <span className="badge badge--status">Ajustar</span>
                      </div>
                      <p className="compact-sub">
                        {r.vehicle?.plate || "—"} · {displayUser(r)} · Desde {r.adjustment_from || "—"}
                      </p>
                    </div>
                    <div className="row-actions">
                      <button
                        className="compact-toggle"
                        onClick={() => openInline(r, "adjustment")}
                        aria-label="Gestionar"
                      >
                        {expandedId === r.id && expandedSection === "adjustment" ? "–" : "+"}
                      </button>
                    </div>
                  </div>
                  {expandedSection === "adjustment" && expandedId === r.id && inlineDraft && renderInlineDetails(r)}
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table policies-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Seguro</th>
                    <th>Patente</th>
                    <th>Usuario</th>
                    <th className="small">Período de ajuste</th>
                    <th>Cuota</th>
                    <th className="actions-col" aria-label="Acciones"></th>
                  </tr>
                </thead>
                <tbody>
                  {adjustmentPageRows.map((r) => (
                    <tr key={`adj-${r.id}`}>
                      <td>{r.number || `#${r.id}`}</td>
                      <td>{displayProduct(r)}</td>
                      <td>{r.vehicle?.plate || "—"}</td>
                      <td>{displayUser(r)}</td>
                      <td className="small">
                        <span className="countdown-chip" title="Días restantes para ajustar">
                          {(() => {
                            const days = adjustmentDaysLeft(r);
                            return days != null ? `${days} día${sPlural(days)}` : "—";
                          })()}
                        </span>
                      </td>
                      <td>${r.premium ?? "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn--outline btn--icon-only" onClick={() => openManage(r)} aria-label="Gestionar póliza">
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
          {adjustmentPageCount > 1 && (
            <div className="pagination pagination--enhanced pagination--section">
              <div className="pagination__controls">
                <button
                  className="btn btn--outline"
                  onClick={() => setAdjustmentPage((p) => Math.max(1, p - 1))}
                  disabled={safeAdjustmentPage <= 1}
                >
                  Anterior
                </button>
                <span className="muted">
                  Página {safeAdjustmentPage} de {adjustmentPageCount}
                </span>
                <button
                  className="btn btn--outline"
                  onClick={() => setAdjustmentPage((p) => Math.min(adjustmentPageCount, p + 1))}
                  disabled={safeAdjustmentPage >= adjustmentPageCount}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
          {adjustmentHasOverflow && (
            <p className="muted small mt-8">
              Solo se muestran las primeras {ADJUSTMENT_SECTION_MAX_ITEMS} pólizas en período de ajuste.
            </p>
          )}
        </div>
      )}

      <div className="card-like">
        <div className="pagination pagination--enhanced">
          <select className="status-filter" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">Todos</option>
            <option value="active">Activa</option>
            <option value="suspended">Suspendida</option>
            <option value="expired">Vencida</option>
            <option value="cancelled">Cancelada</option>
            <option value="inactive">Archivada</option>
          </select>

          <input
            className="admin__search"
            placeholder="Buscar por número de póliza, patente o cliente…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="pagination__controls">
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
              Anterior
            </button>
            <span className="muted">
              Página {safePage} de {pageCount}
            </span>
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}>
              Siguiente
            </button>
          </div>
        </div>

        {/* Tabla general */}
        {compact ? (
          <div className="compact-list">
            {loading ? (
              <p className="muted">Cargando…</p>
            ) : paginatedRows.length === 0 ? (
              <p className="muted">Sin resultados.</p>
            ) : (
              paginatedRows.map((r) => (
                <div className="compact-item" key={r.id}>
                  <div className="compact-main">
                    <div className="compact-text">
                      <div className="compact-title-row">
                        <p className="compact-title">{r.number || `#${r.id}`}</p>
                        <span className={statusClass(r.status)}>{r.status}</span>
                      </div>
                      <p className="compact-sub">{r.vehicle?.plate || "—"} · {displayUser(r)}</p>
                      <p className="muted small">
                        {r.start_date || "—"} → {visibleEndDate(r) || "—"} · Cuota ${r.premium ?? "—"}
                      </p>
                    </div>
                    <button
                      className="compact-toggle"
                      onClick={() => openInline(r, "general")}
                      aria-label="Gestionar"
                    >
                      {expandedId === r.id && expandedSection === "general" ? "–" : "+"}
                    </button>
                  </div>
                  {expandedSection === "general" && expandedId === r.id && inlineDraft && renderInlineDetails(r)}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table policies-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Seguro</th>
                  <th>Patente</th>
                  <th>Usuario</th>
                  <th>Estado</th>
                  <th>Cuota</th>
                  <th className="actions-col" aria-label="Acciones"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10}>Cargando…</td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={10}>Sin resultados.</td>
                  </tr>
                ) : (
                  paginatedRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.number || `#${r.id}`}</td>
                      <td>{displayProduct(r)}</td>
                      <td>{r.vehicle?.plate || "—"}</td>
                      <td>{displayUser(r)}</td>
                      <td>
                        <span className={statusClass(r.status)}>{r.status || "—"}</span>
                      </td>
                      <td>${r.premium ?? "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn--outline btn--icon-only" onClick={() => openManage(r)} aria-label="Gestionar póliza">
                            <GearIcon />
                          </button>
                        </div>
                      </td>
                </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination pagination--enhanced pagination--end">
          <div className="pagination__controls">
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
              Anterior
            </button>
            <span className="muted">
              Página {safePage} de {pageCount}
            </span>
            <button className="btn btn--outline" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}>
              Siguiente
            </button>
          </div>
        </div>
      </div>

      {/* Archivadas */}
      <div className="card-like recovery-card">
        <div className="admin__head admin__head--tight">
          <div className="recovery-head">
            <h3 className="heading-tight m-0">Pólizas eliminadas</h3>
          </div>
          <button type="button" className="btn btn--subtle" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Ocultar" : "Ver lista"}
          </button>
        </div>
        {showArchived && (
          archivedFiltered.length === 0 ? (
            <p className="muted">No hay pólizas inactivas.</p>
          ) : (
            <div className="table-wrap">
              <table className="table policies-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Patente</th>
                    <th>Usuario</th>
                    <th className="actions-col" aria-label="Acciones"></th>
                  </tr>
                </thead>
                <tbody>
                  {archivedFiltered.map((r) => (
                    <tr key={`arch-${r.id}`}>
                      <td>{r.number || `#${r.id}`}</td>
                      <td>{r.vehicle?.plate || "—"}</td>
                      <td>{displayUser(r)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn--outline" onClick={() => askRestore(r)}>
                            Recuperar
                          </button>
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

      {/* --- Manage Modal --- */}
      {manageModal.open && manageModal.row && manageModal.draft && (
        <div className="drawer drawer--modal">
          <div className="drawer__panel manage-modal">
            <div className="drawer__head">
              <h2>Gestionar póliza {manageModal.row?.number || `#${manageModal.row?.id}`}</h2>
              <button className="drawer__close" aria-label="Cerrar" onClick={closeManage}>
                &times;
              </button>
            </div>

            <div className="drawer__body">
              <div className="detail-list">
                <div className="detail-row">
                  <div className="detail-label">Día de vencimiento real</div>
                  <div className="detail-value muted">
                    {displayRealDue(previewRow)}
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Periodo de pago</div>
                  <div className="detail-value muted">
                    {paymentWindowLabel(previewRow || {}, paymentWindowDays, dueDayDisplay)}
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Estado de pago (ventana)</div>
                  <div className="detail-value">
                    <p className="m-0 muted">
                      {paymentWindowStatus(previewRow || manageModal.row, paymentWindowDays, dueDayDisplay, manualPaymentQueued)}
                    </p>
                    {!manageModal.row?.has_paid_in_window && (
                      <button
                        className="btn btn--subtle mt-8"
                        onClick={queueManualPayment}
                        disabled={
                          !inPaymentWindow(previewRow || manageModal.row, paymentWindowDays, dueDayDisplay) || manualPaying || manualPaymentQueued
                        }
                      >
                        {manualPaymentQueued ? "Se registrará al guardar" : manualPaying ? "Registrando…" : "Registrar pago manual"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Cuota del período</div>
                  <div className="detail-value">
                    {(() => {
                      const inst = currentInstallmentInfo(manageModal.row);
                      if (!inst) return "—";
                      return (
                        <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
                          <span className={`badge badge--status ${inst.badgeClass || ""}`}>{inst.label}</span>
                          {inst.due && <span className="muted small">Venc. real: {inst.due}</span>}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Periodo de ajuste</div>
                  <div className="detail-value muted">{adjustmentWindowLabel(previewRow || {})}</div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Usuario</div>
                  <select
                    className={inputClass("detail-input", manageErrors.user_id)}
                    value={manageModal.draft.user_id ?? ""}
                    onChange={(e) => {
                      updateManageDraft("user_id", e.target.value ? Number(e.target.value) : null);
                      setManageErrors((er) => {
                        const next = { ...er };
                        delete next.user_id;
                        return next;
                      });
                    }}
                  >
                    <option value="">— Sin usuario —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Estado</div>
                  <select className="detail-input" value={manageModal.draft.status} onChange={(e) => updateManageDraft("status", e.target.value)}>
                    <option value="active">Activa</option>
                    <option value="suspended">Suspendida</option>
                    <option value="expired">Vencida</option>
                    <option value="cancelled">Cancelada</option>
                  </select>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Vigencia</div>
                  <div className="detail-value detail-inline detail-inline--dates">
                    <input
                      className={inputClass("detail-input", manageErrors.start_date)}
                      type="date"
                      value={manageModal.draft.start_date}
                      onChange={(e) => {
                        handleManageStartChange(e.target.value);
                        setManageErrors((er) => {
                          const next = { ...er };
                          delete next.start_date;
                          return next;
                        });
                      }}
                    />
                    <input
                      className={inputClass("detail-input", manageErrors.end_date)}
                      type="date"
                      value={manageModal.draft.end_date}
                      onChange={(e) => {
                        updateManageDraft("end_date", e.target.value);
                        setManageErrors((er) => {
                          const next = { ...er };
                          delete next.end_date;
                          return next;
                        });
                      }}
                    />
                  </div>
                  {(manageErrors.start_date || manageErrors.end_date) && (
                    <small className="field-error">
                      {manageErrors.start_date || manageErrors.end_date}
                    </small>
                  )}
                </div>

                <div className="detail-row">
                  <div className="detail-label">Cuota</div>
                  <input
                    className={inputClass("detail-input", manageErrors.premium)}
                    value={manageModal.draft.premium ?? ""}
                    onChange={(e) => {
                      updateManageDraft("premium", e.target.value);
                      setManageErrors((er) => {
                        const next = { ...er };
                        delete next.premium;
                        return next;
                      });
                    }}
                  />
                  {manageErrors.premium && <small className="field-error">{manageErrors.premium}</small>}
                </div>

                <div className="detail-row">
                  <div className="detail-label">Vehículo</div>
                  <div className="detail-value detail-inline vehicle-grid">
                    <input className="detail-input" placeholder="Patente" value={manageModal.draft.vehicle?.plate || ""} onChange={(e) => updateManageDraft("plate", e.target.value, true)} />
                    <input className="detail-input" placeholder="Marca" value={manageModal.draft.vehicle?.make || ""} onChange={(e) => updateManageDraft("make", e.target.value, true)} />
                    <input className="detail-input" placeholder="Modelo" value={manageModal.draft.vehicle?.model || ""} onChange={(e) => updateManageDraft("model", e.target.value, true)} />
                    <input className="detail-input" placeholder="Versión" value={manageModal.draft.vehicle?.version || ""} onChange={(e) => updateManageDraft("version", e.target.value, true)} />
                    <input className={inputClass("detail-input", manageErrors.vehicle_year)} placeholder="Año" value={manageModal.draft.vehicle?.year || ""} onChange={(e) => updateManageDraft("year", e.target.value, true)} />
                    <input className="detail-input" placeholder="Ciudad" value={manageModal.draft.vehicle?.city || ""} onChange={(e) => updateManageDraft("city", e.target.value, true)} />
                  </div>
                  {manageErrors.vehicle_year && <small className="field-error">{manageErrors.vehicle_year}</small>}
                </div>

                <div className="detail-row">
                  <div className="detail-label">Cargos pendientes</div>
                  <div className="detail-value">
                    {paymentsError && <div className="field-error">{paymentsError}</div>}
                    {paymentsLoading ? (
                      <p className="muted small">Cargando cargos…</p>
                    ) : charges.length ? (
                      <div className="detail-summary">
                        {charges.map((ch) => (
                          <div key={`${ch.id}-${ch.due_date}`} style={{ marginBottom: 8 }}>
                            <strong>
                              ${Number(ch.amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                            </strong>
                            <div className="muted small">
                              {ch.concept || "Cuota"} · Vence {formatIsoDate(ch.due_date)} · Estado: {ch.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted small">No hay cargos pendientes registrados.</p>
                    )}
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">Recibos</div>
                  <div className="detail-value">
                    {paymentsLoading ? (
                      <p className="muted small">Cargando comprobantes…</p>
                    ) : receipts.length ? (
                      <div className="detail-summary">
                        {receipts.map((rec) => (
                          <div key={`receipt-${rec.id}`} style={{ marginBottom: 8 }}>
                            <div className="muted small">
                              {formatIsoDate(rec.date)} — {rec.concept || "Pago registrado"}
                            </div>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                              <strong>
                                ${Number(rec.amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                              </strong>
                              {rec.file_url ? (
                                <a className="link small" href={rec.file_url} target="_blank" rel="noreferrer">
                                  Descargar PDF
                                </a>
                              ) : (
                                <span className="muted small">Sin comprobante</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted small">No hay comprobantes cargados.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="actions actions--divider actions--spread">
              {manageModal.row?.id ? (
                <button
                  className="btn btn--danger"
                  onClick={() => {
                    askDelete(manageModal.row);
                    closeManage();
                  }}
                  disabled={manageModal.saving}
                >
                  Eliminar
                </button>
              ) : (
                <button className="btn btn--outline" onClick={closeManage} disabled={manageModal.saving}>
                  Cancelar
                </button>
              )}
              <div className="actions actions--row">
                <button className="btn btn--primary" onClick={saveManage} disabled={manageModal.saving}>
                  {manageModal.saving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
          <div className="drawer__scrim" onClick={closeManage} />
        </div>
      )}

      {/* --- Delete Confirm --- */}
      {deleteConfirm.open && deleteConfirm.row && (
        <div className="modal">
          <div className="modal__panel">
            <header className="modal__header">
              <h3 className="modal__title">Eliminar póliza</h3>
              <button
                className="modal__close"
                onClick={() => setDeleteConfirm({ open: false, row: null, loading: false })}
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>
            <div className="modal__body">
              <p className="muted">Se archivará la póliza y se desvinculará del usuario.</p>
            </div>
            <footer className="modal__footer">
              <div className="actions actions--end">
                <button className="btn btn--subtle" onClick={() => setDeleteConfirm({ open: false, row: null, loading: false })} disabled={deleteConfirm.loading}>
                  Cancelar
                </button>
                <button className="btn btn--danger" onClick={confirmDelete} disabled={deleteConfirm.loading}>
                  {deleteConfirm.loading ? "Eliminando…" : "Eliminar"}
                </button>
              </div>
            </footer>
          </div>
          <div className="modal__scrim" onClick={() => setDeleteConfirm({ open: false, row: null, loading: false })} />
        </div>
      )}

      {/* --- Restore Confirm --- */}
      {restoreConfirm.open && restoreConfirm.row && (
        <div className="modal">
          <div className="modal__panel">
            <header className="modal__header">
              <h3 className="modal__title">Restaurar póliza</h3>
              <button
                className="modal__close"
                aria-label="Cerrar"
                onClick={() => setRestoreConfirm({ open: false, row: null, loading: false })}
              >
                ×
              </button>
            </header>
            <div className="modal__body">
              <p className="muted">La póliza volverá a estar activa.</p>
            </div>
            <footer className="modal__footer">
              <div className="actions actions--end">
                <button className="btn btn--outline" onClick={() => setRestoreConfirm({ open: false, row: null, loading: false })} disabled={restoreConfirm.loading}>
                  Cancelar
                </button>
                <button className="btn btn--primary" onClick={confirmRestore} disabled={restoreConfirm.loading}>
                  {restoreConfirm.loading ? "Restaurando…" : "Restaurar"}
                </button>
              </div>
            </footer>
          </div>
          <div className="modal__scrim" onClick={() => setRestoreConfirm({ open: false, row: null, loading: false })} />
        </div>
      )}

      {drawerOpen && editing && (
        <div className="drawer drawer--modal">
          <div className="drawer__panel manage-modal">
            <div className="drawer__head">
              <h2>{editing.id ? "Editar póliza" : "Nueva póliza"}</h2>
              <button className="drawer__close" aria-label="Cerrar" onClick={closeDrawer}>
                &times;
              </button>
            </div>
            <form className="detail-list" onSubmit={handleEditingSubmit}>
              <div className="detail-row">
                <div className="detail-label">Usuario</div>
                <select
                  className={inputClass("detail-input", editingErrors.user_id)}
                  value={editing.user_id ?? ""}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    setEditing((p) => ({ ...p, user_id: val }));
                    setEditingErrors((er) => {
                      const next = { ...er };
                      delete next.user_id;
                      return next;
                    });
                  }}
                >
                  <option value="">— Sin usuario —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="detail-row">
                <div className="detail-label">Número</div>
                <input
                  className={inputClass("detail-input", editingErrors.number)}
                  placeholder="SC-1234"
                  value={editing.number ?? ""}
                  onChange={(e) => {
                    setEditing((p) => ({ ...p, number: e.target.value }));
                    setEditingErrors((er) => {
                      const next = { ...er };
                      delete next.number;
                      return next;
                    });
                  }}
                />
                <small className="muted">Debe comenzar con SC-.</small>
                {editingErrors.number && <small className="field-error">{editingErrors.number}</small>}
              </div>

              <div className="detail-row">
                <div className="detail-label">Producto</div>
                <select
                  className={inputClass("detail-input", editingErrors.product_id)}
                  value={editing.product_id ?? ""}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    setEditing((p) => ({ ...p, product_id: val }));
                    setEditingErrors((er) => {
                      const next = { ...er };
                      delete next.product_id;
                      return next;
                    });
                  }}
                >
                  {products.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name || `Producto #${pr.id}`}
                    </option>
                  ))}
                </select>
                {editingErrors.product_id && <small className="field-error">{editingErrors.product_id}</small>}
              </div>

              <div className="detail-row">
                <div className="detail-label">Vigencia</div>
                <div className="detail-value detail-inline detail-inline--dates">
                  <input
                    className={inputClass("detail-input", editingErrors.start_date)}
                    type="date"
                    value={editing.start_date}
                    onChange={(e) => {
                      handleEditingStartChange(e.target.value);
                      setEditingErrors((er) => {
                        const next = { ...er };
                        delete next.start_date;
                        return next;
                      });
                    }}
                  />
                  <input
                    className={inputClass("detail-input", editingErrors.end_date)}
                    type="date"
                    value={editing.end_date}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditing((p) => ({ ...p, end_date: val }));
                      setEditingErrors((er) => {
                        const next = { ...er };
                        delete next.end_date;
                        return next;
                      });
                    }}
                  />
                </div>
                {(editingErrors.start_date || editingErrors.end_date) && (
                  <small className="field-error">
                    {editingErrors.start_date || editingErrors.end_date}
                  </small>
                )}
              </div>

              <div className="detail-row">
                <div className="detail-label">Cuota</div>
                <input
                  className={inputClass("detail-input", editingErrors.premium)}
                  value={editing.premium ?? ""}
                  onChange={(e) => {
                    setEditing((p) => ({ ...p, premium: e.target.value }));
                    setEditingErrors((er) => {
                      const next = { ...er };
                      delete next.premium;
                      return next;
                    });
                  }}
                />
                {editingErrors.premium && <small className="field-error">{editingErrors.premium}</small>}
              </div>

              <div className="detail-row">
                <div className="detail-label">Vehículo</div>
                <div className="detail-value detail-inline vehicle-grid">
                  <input className="detail-input" placeholder="Patente" value={editing.vehicle?.plate || ""} onChange={(e) => setEditing((p) => ({ ...p, vehicle: { ...(p.vehicle || {}), plate: e.target.value } }))} />
                  <input className="detail-input" placeholder="Marca" value={editing.vehicle?.make || ""} onChange={(e) => setEditing((p) => ({ ...p, vehicle: { ...(p.vehicle || {}), make: e.target.value } }))} />
                  <input className="detail-input" placeholder="Modelo" value={editing.vehicle?.model || ""} onChange={(e) => setEditing((p) => ({ ...p, vehicle: { ...(p.vehicle || {}), model: e.target.value } }))} />
                  <input className="detail-input" placeholder="Versión" value={editing.vehicle?.version || ""} onChange={(e) => setEditing((p) => ({ ...p, vehicle: { ...(p.vehicle || {}), version: e.target.value } }))} />
                  <input className={inputClass("detail-input", editingErrors.vehicle_year)} placeholder="Año" value={editing.vehicle?.year || ""} onChange={(e) => setEditing((p) => ({ ...p, vehicle: { ...(p.vehicle || {}), year: e.target.value } }))} />
                  <input className="detail-input" placeholder="Ciudad" value={editing.vehicle?.city || ""} onChange={(e) => setEditing((p) => ({ ...p, vehicle: { ...(p.vehicle || {}), city: e.target.value } }))} />
                </div>
                {editingErrors.vehicle_year && <small className="field-error">{editingErrors.vehicle_year}</small>}
              </div>

              <div className="detail-row">
                <div className="detail-label">Cargar desde cotización</div>
                <div className="detail-value detail-inline">
                  <input className="detail-input" placeholder="Pegá link de cotización" value={quoteLink} onChange={(e) => setQuoteLink(e.target.value)} />
                  <button className="btn btn--subtle" type="button" onClick={fillFromQuoteLink} disabled={quoteLoading}>
                    {quoteLoading ? "Cargando…" : "Aplicar"}
                  </button>
                </div>
                {quoteLoadErr && <div className="muted" style={{ color: "var(--danger)" }}>{quoteLoadErr}</div>}
              </div>
              <div className="actions actions--divider actions--spread">
                {editing.id ? (
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={() => {
                      askDelete(editing);
                      closeDrawer();
                    }}
                    disabled={false}
                  >
                    Eliminar
                  </button>
                ) : (
                  <button className="btn btn--outline" type="button" onClick={closeDrawer}>
                    Cancelar
                  </button>
                )}
                <button className="btn btn--primary" type="submit">
                  Guardar
                </button>
              </div>
            </form>
          </div>
          <div className="drawer__scrim" onClick={closeDrawer} />
        </div>
      )}
    </section>
  );
}

function formatIsoDate(value) {
  if (!value) return "—";
  const parsed = value.includes("T") ? value : `${value}T00:00:00`;
  const d = new Date(parsed);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}
