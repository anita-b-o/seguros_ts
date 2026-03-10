// frontend/src/pages/admin/AdminHome.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import useAuth from "@/hooks/useAuth";
import { adminSettingsApi } from "@/services/adminSettingsApi";
import { accountApi } from "@/services/accountApi";
import { adminPoliciesApi } from "@/services/adminPoliciesApi";
import { useNavigate } from "react-router-dom";
import "@/styles/adminHome.css";

function isAdminUser(u) {
  if (!u) return false;
  const flag = u.is_admin ?? u.isAdmin ?? u.is_staff ?? u.admin ?? u.role;
  if (typeof flag === "string") {
    const s = flag.toLowerCase();
    if (s === "admin") return true;
    if (["true", "1", "yes", "si"].includes(s)) return true;
  }
  if (typeof flag === "number") return flag === 1;
  if (typeof flag === "boolean") return flag === true;
  return u.role === "admin";
}

function toIntOrEmpty(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Math.trunc(n));
}

// ===== Contact fallback (mismo shape que ContactSection del Home) =====
const CONTACT_FALLBACK = {
  whatsapp: "+54 9 221 000 0000",
  email: "hola@sancayetano.com",
  address: "Av. Ejemplo 1234, La Plata, Buenos Aires",
  map_embed_url:
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3283.798536911205!2d-58.381592984774424!3d-34.603738980460806!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMzTCsDM2JzEzLjQiUyA1OMKwMjInNTUuNyJX!5e0!3m2!1ses!2sar!4v1700000000000",
  schedule: "Lun a Vie 9:00 a 18:00",
};

function normalizeContact(payload) {
  const c = payload || {};
  return {
    whatsapp: c.whatsapp ?? CONTACT_FALLBACK.whatsapp,
    email: c.email ?? CONTACT_FALLBACK.email,
    address: c.address ?? CONTACT_FALLBACK.address,
    map_embed_url: c.map_embed_url ?? CONTACT_FALLBACK.map_embed_url,
    schedule: c.schedule ?? CONTACT_FALLBACK.schedule,
  };
}

function buildContactPatchPayload(contact) {
  return {
    whatsapp: contact.whatsapp,
    email: contact.email,
    address: contact.address,
    map_embed_url: contact.map_embed_url,
    schedule: contact.schedule,
  };
}

export default function AdminHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { logout } = useAuth();
  const isAdmin = isAdminUser(user);

  const [tab, setTab] = useState("perfil"); // perfil | preferencias | contacto

  // ---- PERFIL: change password ----
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [savingPass, setSavingPass] = useState(false);
  const [passMsg, setPassMsg] = useState("");
  const [passErr, setPassErr] = useState("");

  // ---- PREFERENCIAS: AppSettings ----
  const [settings, setSettings] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsErr, setSettingsErr] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");
  const [settingsSavedFlash, setSettingsSavedFlash] = useState(false);

  // ---- CONTACTO: AppSettings(contact_info) ----
  const [contact, setContact] = useState(CONTACT_FALLBACK);
  const [savingContact, setSavingContact] = useState(false);
  const [contactErr, setContactErr] = useState("");
  const [contactMsg, setContactMsg] = useState("");
  const [contactSavedFlash, setContactSavedFlash] = useState(false);

  // ---- NOTIFICACIÓN: pólizas en período de ajuste ----
  const [adjustCount, setAdjustCount] = useState(null); // null = sin cargar
  const [loadingAdjustCount, setLoadingAdjustCount] = useState(false);
  const [unpaidCount, setUnpaidCount] = useState(null);
  const [loadingUnpaidCount, setLoadingUnpaidCount] = useState(false);
  const settingsFlashTimer = useRef(null);
  const contactFlashTimer = useRef(null);

  const form = useMemo(() => {
    const s = settings || {};
    return {
      payment_window_days: toIntOrEmpty(s.payment_window_days),
      client_expiration_offset_days: toIntOrEmpty(s.client_expiration_offset_days),
      default_term_months: toIntOrEmpty(s.default_term_months),

      // período de ajuste (en días antes de end_date)
      policy_adjustment_window_days: toIntOrEmpty(
        s.policy_adjustment_window_days ?? s.adjustment_window_days
      ),
    };
  }, [settings]);

  const [paymentWindowDays, setPaymentWindowDays] = useState("");
  const [clientOffsetDays, setClientOffsetDays] = useState("");
  const [defaultTermMonths, setDefaultTermMonths] = useState("");
  const [policyAdjustmentWindowDays, setPolicyAdjustmentWindowDays] = useState("");

  useEffect(() => {
    if (!isAdmin) return;

    // inicializar form cuando llega settings
    setPaymentWindowDays(form.payment_window_days);
    setClientOffsetDays(form.client_expiration_offset_days);
    setDefaultTermMonths(form.default_term_months);
    setPolicyAdjustmentWindowDays(form.policy_adjustment_window_days);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.updated_at, isAdmin]);

  // Cargar contador de pólizas en ajuste al entrar al admin
  useEffect(() => {
    if (!isAdmin) return;

    (async () => {
      setLoadingAdjustCount(true);
      try {
        const data = await adminPoliciesApi.adjustmentCount();
        const n = Number(data?.count);
        setAdjustCount(Number.isFinite(n) ? n : 0);
      } catch (e) {
        setAdjustCount(null);
      } finally {
        setLoadingAdjustCount(false);
      }
    })();
  }, [isAdmin]);

  useEffect(() => {
    return () => {
      if (settingsFlashTimer.current) clearTimeout(settingsFlashTimer.current);
      if (contactFlashTimer.current) clearTimeout(contactFlashTimer.current);
    };
  }, []);

  // Cargar contador de pólizas no abonadas al entrar al admin
  useEffect(() => {
    if (!isAdmin) return;

    (async () => {
      setLoadingUnpaidCount(true);
      try {
        const data = await adminPoliciesApi.stats();
        const n = Number(data?.soft_overdue_unpaid?.count);
        setUnpaidCount(Number.isFinite(n) ? n : 0);
      } catch (e) {
        setUnpaidCount(null);
      } finally {
        setLoadingUnpaidCount(false);
      }
    })();
  }, [isAdmin]);

  // Cargar settings cuando entro a Preferencias
  useEffect(() => {
    if (!isAdmin) return;
    if (tab !== "preferencias") return;

    (async () => {
      setLoadingSettings(true);
      setSettingsErr("");
      setSettingsMsg("");
      try {
        const data = await adminSettingsApi.get();
        setSettings(data);
      } catch (e) {
        setSettings(null);
        setSettingsErr("No se pudieron cargar las preferencias.");
      } finally {
        setLoadingSettings(false);
      }
    })();
  }, [tab, isAdmin]);

  // Cargar contacto cuando entro a Contacto
  useEffect(() => {
    if (!isAdmin) return;
    if (tab !== "contacto") return;

    (async () => {
      setContactErr("");
      setContactMsg("");
      try {
        const { data } = await api.get("/common/contact-info/");
        setContact(normalizeContact(data));
      } catch (e) {
        setContact(CONTACT_FALLBACK);
        setContactErr("No se pudieron cargar los datos de contacto.");
      }
    })();
  }, [tab, isAdmin]);

  // --- VALIDACIÓN UI (Preferencias) ---
  const uiSettingsError = useMemo(() => {
    const w = Number(paymentWindowDays);
    const o = Number(clientOffsetDays);
    const t = Number(defaultTermMonths);
    const adj = Number(policyAdjustmentWindowDays);

    if (!paymentWindowDays || !clientOffsetDays || !defaultTermMonths || !policyAdjustmentWindowDays) {
      return "";
    }

    if (!Number.isFinite(w) || !Number.isFinite(o) || !Number.isFinite(t) || !Number.isFinite(adj)) {
      return "Ingresá valores numéricos válidos.";
    }

    if (w < 1) return "payment_window_days debe ser >= 1.";
    if (o < 0) return "client_expiration_offset_days debe ser >= 0.";
    if (o >= w) return "client_expiration_offset_days debe ser menor que payment_window_days.";
    if (t < 1) return "default_term_months debe ser >= 1.";
    if (adj < 1) return "policy_adjustment_window_days debe ser >= 1.";
    if (adj > 365) return "policy_adjustment_window_days parece demasiado alto (máx 365).";

    return "";
  }, [
    paymentWindowDays,
    clientOffsetDays,
    defaultTermMonths,
    policyAdjustmentWindowDays,
  ]);

  const canSaveSettings = useMemo(() => {
    if (savingSettings || loadingSettings) return false;

    if (!paymentWindowDays || !clientOffsetDays || !defaultTermMonths || !policyAdjustmentWindowDays) {
      return false;
    }
    if (uiSettingsError) return false;

    return true;
  }, [
    savingSettings,
    loadingSettings,
    paymentWindowDays,
    clientOffsetDays,
    defaultTermMonths,
    policyAdjustmentWindowDays,
    uiSettingsError,
  ]);

  const onSaveSettings = async () => {
    setSettingsErr("");
    setSettingsMsg("");

    if (uiSettingsError) {
      setSettingsErr(uiSettingsError);
      return;
    }

    setSavingSettings(true);
    try {
      const payload = {
        payment_window_days: Number(paymentWindowDays),
        client_expiration_offset_days: Number(clientOffsetDays),
        default_term_months: Number(defaultTermMonths),
        policy_adjustment_window_days: Number(policyAdjustmentWindowDays),
      };

      const data = await adminSettingsApi.patch(payload);
      setSettings(data);
      setSettingsMsg("Preferencias actualizadas.");
      setSettingsSavedFlash(true);
      if (settingsFlashTimer.current) clearTimeout(settingsFlashTimer.current);
      settingsFlashTimer.current = setTimeout(() => setSettingsSavedFlash(false), 2500);
    } catch (e) {
      setSettingsErr("No se pudieron guardar las preferencias.");
    } finally {
      setSavingSettings(false);
    }
  };

  // --- CONTACTO ---
  const waLink = useMemo(() => {
    const digits = String(contact.whatsapp || "").replace(/\D/g, "");
    return digits ? `https://wa.me/${digits}` : "";
  }, [contact.whatsapp]);

  const onSaveContact = async () => {
    setContactErr("");
    setContactMsg("");

    // validación simple
    if (!contact.whatsapp || !contact.email || !contact.address) {
      setContactErr("Completá WhatsApp, email y dirección.");
      return;
    }

    setSavingContact(true);
    try {
      const payload = buildContactPatchPayload(contact);
      const { data } = await api.patch("/common/contact-info/", payload);
      setContact(normalizeContact(data));
      setContactMsg("Datos de contacto actualizados.");
      setContactSavedFlash(true);
      if (contactFlashTimer.current) clearTimeout(contactFlashTimer.current);
      contactFlashTimer.current = setTimeout(() => setContactSavedFlash(false), 2500);
    } catch (e) {
      setContactErr("No se pudieron guardar los datos de contacto.");
    } finally {
      setSavingContact(false);
    }
  };

  const onChangePassword = async (e) => {
    e.preventDefault();
    setPassErr("");
    setPassMsg("");

    if (!currentPass || !newPass) {
      setPassErr("Completá tu contraseña actual y la nueva.");
      return;
    }
    if (newPass.length < 8) {
      setPassErr("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPass !== newPass2) {
      setPassErr("La confirmación no coincide.");
      return;
    }

    setSavingPass(true);
    try {
      await accountApi.changeMyPassword({
        current_password: currentPass,
        new_password: newPass,
      });
      setPassMsg("Contraseña actualizada.");
      setCurrentPass("");
      setNewPass("");
      setNewPass2("");
    } catch (err) {
      setPassErr("No se pudo cambiar la contraseña (verificá la actual).");
    } finally {
      setSavingPass(false);
    }
  };

  const adjustBannerText = useMemo(() => {
    if (loadingAdjustCount) return "Revisando pólizas en período de ajuste…";
    if (adjustCount == null) return "";
    if (adjustCount <= 0) return "";
    if (adjustCount === 1) return "Hay 1 póliza en período de ajuste.";
    return `Hay ${adjustCount} pólizas en período de ajuste.`;
  }, [loadingAdjustCount, adjustCount]);

  const unpaidBannerText = useMemo(() => {
    if (loadingUnpaidCount) return "Revisando pólizas no abonadas…";
    if (unpaidCount == null) return "";
    if (unpaidCount <= 0) return "";
    if (unpaidCount === 1) return "Hay 1 póliza no abonada.";
    return `Hay ${unpaidCount} pólizas no abonadas.`;
  }, [loadingUnpaidCount, unpaidCount]);

  return (
    <div className="admin-page" style={{ padding: 24 }}>
      {!isAdmin ? (
        <div style={{ padding: 24 }}>
          <h2>Admin</h2>
          <p>No tenés permisos para ver esta sección.</p>
        </div>
      ) : null}

      {isAdmin ? (
      <div style={{ marginBottom: 14 }}>
        {(adjustBannerText || unpaidBannerText) ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            {adjustBannerText ? (
              <div
                className="admin-notice"
                style={{
                  padding: "10px 14px",
                  maxWidth: 620,
                  width: "100%",
                  textAlign: "center",
                  background: "linear-gradient(90deg, #0b2f6a, #0f4aa5)",
                  border: "1px solid rgba(15, 74, 165, 0.35)",
                  color: "#fff",
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  borderRadius: 12,
                  boxShadow: "0 8px 18px rgba(11, 47, 106, 0.2)",
                }}
              >
                {adjustBannerText}
              </div>
            ) : null}

            {unpaidBannerText ? (
              <div
                className="admin-notice"
                style={{
                  padding: "10px 14px",
                  maxWidth: 620,
                  width: "100%",
                  textAlign: "center",
                  background: "linear-gradient(90deg, #0b2f6a, #0f4aa5)",
                  border: "1px solid rgba(15, 74, 165, 0.35)",
                  color: "#fff",
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  borderRadius: 12,
                  boxShadow: "0 8px 18px rgba(11, 47, 106, 0.2)",
                }}
              >
                {unpaidBannerText}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 className="admin-title" style={{ marginBottom: 6 }}>
            Panel Admin
          </h1>
          <button
            className="btn-secondary"
            type="button"
            onClick={async () => {
              try {
                await logout();
              } finally {
                navigate("/login", { replace: true });
              }
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
      ) : null}

      {/* Tabs */}
      {isAdmin ? (
      <div className="admin-tabs" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          className={tab === "perfil" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("perfil")}
        >
          Perfil
        </button>
        <button
          type="button"
          className={tab === "preferencias" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("preferencias")}
        >
          Preferencias
        </button>
        <button
          type="button"
          className={tab === "contacto" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("contacto")}
        >
          Contacto
        </button>
      </div>
      ) : null}

      {/* PERFIL */}
      {isAdmin && tab === "perfil" ? (
        <div className="table-card" style={{ padding: 14 }}>
          <div className="table-head" style={{ marginBottom: 12 }}>
            <div className="table-title">Tu cuenta</div>
            <div className="table-muted">Administración de credenciales</div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="info-k">Email</div>
            <div className="info-v mono">{user?.email || "-"}</div>
          </div>

          <form onSubmit={onChangePassword}>
            <label className="form-label">
              Contraseña actual
              <input
                className="form-input"
                type="password"
                value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
                autoComplete="current-password"
                disabled={savingPass}
                required
              />
            </label>

            <label className="form-label">
              Nueva contraseña
              <input
                className="form-input"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                autoComplete="new-password"
                disabled={savingPass}
                required
              />
            </label>

            <label className="form-label">
              Repetir nueva contraseña
              <input
                className="form-input"
                type="password"
                value={newPass2}
                onChange={(e) => setNewPass2(e.target.value)}
                autoComplete="new-password"
                disabled={savingPass}
                required
              />
            </label>

            {passErr ? <div className="admin-alert">{passErr}</div> : null}
            {passMsg ? (
              <div className="admin-alert success" style={{ opacity: 0.9 }}>
                {passMsg}
              </div>
            ) : null}

            <div className="modal-actions" style={{ marginTop: 10 }}>
              <button className="btn-primary" type="submit" disabled={savingPass}>
                {savingPass ? "Guardando…" : "Cambiar contraseña"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* PREFERENCIAS */}
      {isAdmin && tab === "preferencias" ? (
        <div className="table-card" style={{ padding: 14 }}>
          <div className="table-head" style={{ marginBottom: 12 }}>
            <div className="table-title">Preferencias de pólizas</div>
            <div className="table-muted">
              {loadingSettings ? "Cargando…" : "Configuración global"}
            </div>
          </div>

          <div className="table-muted" style={{ marginBottom: 10 }}>
            Estos cambios se aplican a nuevas pólizas y a los próximos cálculos. No
            reescriben períodos ya cerrados.
          </div>

          {settingsErr ? <div className="admin-alert">{settingsErr}</div> : null}
          {settingsMsg ? (
            <div className="admin-alert success" style={{ opacity: 0.9 }}>
              {settingsMsg}
            </div>
          ) : null}

          <label className="form-label">
            Días del período de pago
            <input
              className="form-input"
              value={paymentWindowDays}
              onChange={(e) => setPaymentWindowDays(toIntOrEmpty(e.target.value))}
              disabled={loadingSettings || savingSettings}
              inputMode="numeric"
              placeholder="Ej: 10"
            />
            <div className="info-hint">
              Define cuántos días tiene el período de pago del ciclo actual.
            </div>
          </label>

          <label className="form-label">
            Días de vencimiento visible (para el cliente)
            <input
              className={`form-input ${uiSettingsError ? "is-invalid" : ""}`}
              value={clientOffsetDays}
              onChange={(e) => setClientOffsetDays(toIntOrEmpty(e.target.value))}
              disabled={loadingSettings || savingSettings}
              inputMode="numeric"
              placeholder="Ej: 3"
            />
            <div className="info-hint">
              Cuántos días antes del vencimiento real se muestra el vencimiento al cliente. Debe ser menor al período de pago.
            </div>
            {uiSettingsError ? <div className="field-err">{uiSettingsError}</div> : null}
          </label>

          <label className="form-label">
            Meses de vigencia por defecto
            <input
              className="form-input"
              value={defaultTermMonths}
              onChange={(e) => setDefaultTermMonths(toIntOrEmpty(e.target.value))}
              disabled={loadingSettings || savingSettings}
              inputMode="numeric"
              placeholder="Ej: 3"
            />
            <div className="info-hint">Duración por defecto para nuevas pólizas o renovaciones.</div>
          </label>

          <label className="form-label">
            Días de período de ajuste
            <input
              className="form-input"
              value={policyAdjustmentWindowDays}
              onChange={(e) => setPolicyAdjustmentWindowDays(toIntOrEmpty(e.target.value))}
              disabled={loadingSettings || savingSettings}
              inputMode="numeric"
              placeholder="Ej: 5"
            />
            <div className="info-hint">
              Días antes de finalizar la vigencia en los que la póliza entra en período de ajuste.
            </div>
          </label>

          <div className="modal-actions" style={{ marginTop: 10 }}>
            <button
              className="btn-primary"
              type="button"
              onClick={onSaveSettings}
              disabled={!canSaveSettings}
            >
              {savingSettings ? "Guardando…" : settingsSavedFlash ? "Guardado" : "Guardar preferencias"}
            </button>
            {settingsSavedFlash ? <span className="admin-inline-status">Guardado</span> : null}
          </div>
        </div>
      ) : null}

      {/* CONTACTO */}
      {isAdmin && tab === "contacto" ? (
        <div className="table-card" style={{ padding: 14 }}>
          <div className="table-head" style={{ marginBottom: 12 }}>
            <div className="table-title">Datos de contacto (Home)</div>
            <div className="table-muted">
              {loadingSettings ? "Cargando…" : "Sección Contacto del sitio público"}
            </div>
          </div>

          {contactErr ? <div className="admin-alert">{contactErr}</div> : null}
          {contactMsg ? (
            <div className="admin-alert success" style={{ opacity: 0.9 }}>
              {contactMsg}
            </div>
          ) : null}

          <label className="form-label">
            WhatsApp
            <input
              className="form-input"
              value={contact.whatsapp}
              onChange={(e) =>
                setContact((prev) => ({ ...prev, whatsapp: e.target.value }))
              }
              disabled={loadingSettings || savingContact}
              placeholder="+54 9 221 ..."
            />
            {waLink ? (
              <div className="info-hint">
                Link:{" "}
                <a href={waLink} target="_blank" rel="noreferrer">
                  {waLink}
                </a>
              </div>
            ) : null}
          </label>

          <label className="form-label">
            Email
            <input
              className="form-input"
              value={contact.email}
              onChange={(e) =>
                setContact((prev) => ({ ...prev, email: e.target.value }))
              }
              disabled={loadingSettings || savingContact}
              placeholder="hola@..."
            />
          </label>

          <label className="form-label">
            Dirección
            <input
              className="form-input"
              value={contact.address}
              onChange={(e) =>
                setContact((prev) => ({ ...prev, address: e.target.value }))
              }
              disabled={loadingSettings || savingContact}
              placeholder="Calle, Ciudad, Provincia"
            />
          </label>

          <label className="form-label">
            Horario
            <input
              className="form-input"
              value={contact.schedule}
              onChange={(e) =>
                setContact((prev) => ({ ...prev, schedule: e.target.value }))
              }
              disabled={loadingSettings || savingContact}
              placeholder="Lun a Vie 9:00 a 18:00"
            />
          </label>

          <label className="form-label">
            Mapa (embed URL)
            <textarea
              className="form-input"
              style={{ minHeight: 120, resize: "vertical" }}
              value={contact.map_embed_url}
              onChange={(e) =>
                setContact((prev) => ({ ...prev, map_embed_url: e.target.value }))
              }
              disabled={loadingSettings || savingContact}
              placeholder="https://www.google.com/maps/embed?pb=..."
            />
            <div className="info-hint">Pegá la URL de “Embed a map” (no el link normal).</div>
          </label>

          <div style={{ marginTop: 10 }}>
            <div className="info-k" style={{ marginBottom: 8 }}>
              Vista previa
            </div>
            <iframe
              src={contact.map_embed_url || CONTACT_FALLBACK.map_embed_url}
              title="Mapa de la oficina"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ width: "100%", height: 260, border: 0, borderRadius: 12 }}
              allowFullScreen
            />
          </div>

          <div className="modal-actions" style={{ marginTop: 10 }}>
            <button
              className="btn-primary"
              type="button"
              onClick={onSaveContact}
              disabled={loadingSettings || savingContact}
            >
              {savingContact ? "Guardando…" : contactSavedFlash ? "Guardado" : "Guardar contacto"}
            </button>
            {contactSavedFlash ? <span className="admin-inline-status">Guardado</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
