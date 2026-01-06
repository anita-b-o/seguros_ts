import { useEffect, useRef, useState } from "react";
import { listAdminPolicies, getAdminSettings, patchAdminUser, patchAdminSettings } from "@/services";
import useAuth from "@/hooks/useAuth";
import LogoutButton from "@/components/auth/LogoutButton";
import { daysUntil, isPolicyExpiringAfterWindow } from "./policyHelpers";

export default function AdminHome() {
  const { user, setSession } = useAuth();
  const [profile, setProfile] = useState({ email: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [paymentWindow, setPaymentWindow] = useState(5);
  const [defaultTerm, setDefaultTerm] = useState(3);
  const [dueDayDisplay, setDueDayDisplay] = useState(5);
  const [expiringThresholdDays, setExpiringThresholdDays] = useState(30);
  const [expiringCount, setExpiringCount] = useState(0);
  const [adjustmentWindowDays, setAdjustmentWindowDays] = useState(7);
  const [adjustmentCount, setAdjustmentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasPolicies, setHasPolicies] = useState(false);
  const [err, setErr] = useState("");
  const isMounted = useRef(false);
  const showExpiringAlert = expiringCount > 0 && !loading && hasPolicies;
  const showAdjustmentAlert = adjustmentCount > 0 && !loading;

  useEffect(() => {
    if (user) {
      setProfile({
        email: user.email || "",
      });
    }
  }, [user]);

  useEffect(() => {
    isMounted.current = true;
    loadHomeData();
    return () => {
      isMounted.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchAllPolicies() {
    const pageSize = 100;
    let page = 1;
    const accumulated = [];
    while (true) {
      const { data } = await listAdminPolicies({
        params: { page, page_size: pageSize },
      });
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];
      if (!list.length) break;
      accumulated.push(...list);
      if (!data?.next) break;
      page += 1;
    }
    return accumulated;
  }

  async function loadHomeData() {
    setErr("");
    setLoading(true);
    try {
      const { data } = await getAdminSettings();
      const payWindowValue = Number(data?.payment_window_days);
      const displayValue = Number(data?.payment_due_day_display);
      const thresholdValue = Number(data?.expiring_threshold_days);
      const termValue = Number(data?.default_term_months);

      const windowForCounts = Number.isFinite(payWindowValue) && payWindowValue >= 0 ? payWindowValue : DEFAULT_PAYMENT_WINDOW;
      const dueDayForCounts = Number.isFinite(displayValue) && displayValue > 0 ? displayValue : DEFAULT_DUE_DAY;
      const thresholdForCounts = Number.isFinite(thresholdValue) && thresholdValue > 0 ? thresholdValue : DEFAULT_THRESHOLD;
      if (!isMounted.current) return;

      if (Number.isFinite(payWindowValue) && payWindowValue >= 0) setPaymentWindow(payWindowValue);
      if (Number.isFinite(displayValue) && displayValue > 0) setDueDayDisplay(displayValue);
      if (Number.isFinite(thresholdValue) && thresholdValue > 0) setExpiringThresholdDays(thresholdValue);
      if (Number.isFinite(termValue) && termValue > 0) setDefaultTerm(termValue);

      const adjustmentValue = Number(data?.policy_adjustment_window_days);
      if (Number.isFinite(adjustmentValue) && adjustmentValue >= 0) {
        setAdjustmentWindowDays(adjustmentValue);
      }

      const list = await fetchAllPolicies();
      if (!isMounted.current) return;
      setHasPolicies(list.length > 0);
      const count = list.filter((p) =>
        isPolicyExpiringAfterWindow(p, windowForCounts, dueDayForCounts, thresholdForCounts)
      ).length;
      setExpiringCount(count);
      const adjustmentInWindow = list.filter((p) => {
        const from = p.adjustment_from;
        const to = p.adjustment_to;
        const startDiff = daysUntil(from);
        const endDiff = daysUntil(to);
        const inWindow =
          Number.isFinite(startDiff) && startDiff <= 0 && (!Number.isFinite(endDiff) || endDiff >= 0);
        const stillActive = daysUntil(p.client_end_date || p.end_date) >= 0;
        return p.status === "active" && inWindow && stillActive;
      }).length;
      setAdjustmentCount(adjustmentInWindow);
    } catch (e) {
      if (!isMounted.current) return;
      setErr(e?.response?.data?.detail || "No se pudo cargar la información.");
      setExpiringCount(0);
      setAdjustmentCount(0);
      setHasPolicies(false);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!user?.id) return;
    if (password && password !== passwordConfirm) {
      setErr("Las contraseñas no coinciden.");
      return;
    }
    setSavingProfile(true);
    setErr("");
    try {
      const payload = { email: profile.email };
      if (password) payload.password = password;
      const { data } = await patchAdminUser(user.id, payload);
      setSession({ user: data ? { ...user, ...data } : user });
      setPassword("");
      setPasswordConfirm("");
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "No se pudo guardar el perfil.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePrefs() {
    setSavingThreshold(true);
    setErr("");
    try {
      await patchAdminSettings({
        payment_window_days: paymentWindow,
        payment_due_day_display: dueDayDisplay,
        expiring_threshold_days: expiringThresholdDays,
        default_term_months: defaultTerm,
        policy_adjustment_window_days: adjustmentWindowDays,
      });
      await loadHomeData();
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "No se pudo guardar las preferencias.");
    } finally {
      setSavingThreshold(false);
    }
  }

  return (
    <section className="section container policies-page">
      <header className="admin__head">
        <div>
          <h1>Inicio admin</h1>
        </div>
        <div className="admin__head-actions">
          <LogoutButton className="btn btn--primary" />
        </div>
      </header>

      {showExpiringAlert && (
        <div className="alert-bar alert-bar--danger">
          Hay {expiringCount} póliza(s) próximas a vencer.
        </div>
      )}
      {showAdjustmentAlert && (
        <div className="alert-bar alert-bar--warning">
          Hay {adjustmentCount} póliza(s) en periodo de ajuste.
        </div>
      )}

      <div className="card-like admin-home__card mb-12">
        <h3 className="heading-tight">Tus datos</h3>
        <form className="form" onSubmit={saveProfile}>
          <div className="grid admin-grid--auto-220">
            <div className="field">
              <label>Email</label>
              <input type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Nueva contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Dejar en blanco para no cambiarla"
              />
            </div>
            <div className="field">
              <label>Confirmar contraseña</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="Repetí la nueva contraseña"
              />
            </div>
          </div>
          <div className="actions actions--end">
            <button className="btn btn--primary" type="submit" disabled={savingProfile}>
              {savingProfile ? "Guardando…" : "Guardar datos"}
            </button>
          </div>
        </form>
      </div>

      <div className="card-like admin-home__card mb-12">
        <h3 className="heading-tight">Preferencias</h3>
        <div className="admin-home__prefs">
        {[{
          label: "Duración de la póliza (en meses)",
          helper: "Define cuántos meses dura una póliza desde su fecha de inicio.",
          value: defaultTerm,
          onChange: (e) => setDefaultTerm(Number(e.target.value)),
          options: [1, 3, 6, 12].map((n) => ({ value: n, label: `${n} mes${n === 1 ? "" : "es"}` })),
        }, {
          label: "Duración del período de pago (en días)",
          helper: "Cantidad de días disponibles para pagar cada cuota desde el inicio del período mensual.",
          value: paymentWindow,
          onChange: (e) => setPaymentWindow(Number(e.target.value)),
          options: [0, 3, 5, 7, 10, 15].map((n) => ({ value: n, label: `${n} día${n === 1 ? "" : "s"}` })),
        }, {
          label: "Día de vencimiento visible para el cliente",
          helper: "Día del período de pago que se muestra como vencimiento al cliente. No modifica la fecha real de vencimiento.",
          value: dueDayDisplay,
          onChange: (e) => setDueDayDisplay(Number(e.target.value)),
          options: Array.from({ length: 31 }, (_, idx) => idx + 1).map((day) => ({ value: day, label: `${day}` })),
        }, {
          label: "Período de ajuste (días antes del fin)",
          helper: "Define cuántos días antes del fin de la póliza se habilita la ventana de ajuste.",
          value: adjustmentWindowDays,
          onChange: (e) => setAdjustmentWindowDays(Number(e.target.value)),
          options: [0, 3, 5, 7, 10, 14, 21, 30].map((n) => ({ value: n, label: `${n} día${n === 1 ? "" : "s"}` })),
        }].map(({ label, helper, value, onChange, options }) => (
          <div
            key={label}
            className="admin-home__prefs-row"
            style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}
          >
            <span className="muted" style={{ minWidth: 220 }}>
              {label}
            </span>
            <select value={value} onChange={onChange} disabled={savingThreshold}>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="muted" style={{ flex: 1 }}>
              {helper}
            </span>
          </div>
        ))}
          <div className="actions actions--end admin-home__prefs-actions">
            <button className="btn btn--primary" onClick={savePrefs} disabled={savingThreshold}>Guardar preferencia</button>
          </div>
        </div>
      </div>
    </section>
  );
}
