// src/pages/dashboard/ProfilePage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import useAuth from "@/hooks/useAuth";
import { accountApi } from "@/services/accountApi";
import "@/styles/dashboard.css";

function toISODateInput(v) {
  if (!v) return "";
  // soporta "YYYY-MM-DD..." o Date
  if (typeof v === "string") return v.slice(0, 10);
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function normalizeError(e) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const detail = data?.detail || data?.message || null;

  if (status === 401) return "Tu sesión expiró. Volvé a iniciar sesión.";
  if (detail) return String(detail);

  // errores por campo (DRF)
  if (data && typeof data === "object") {
    const firstKey = Object.keys(data)[0];
    if (firstKey) {
      const msg = Array.isArray(data[firstKey]) ? data[firstKey][0] : data[firstKey];
      if (msg) return String(msg);
    }
  }

  return "Ocurrió un error. Probá de nuevo.";
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, loadMe, logout } = useAuth();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);

  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [pwdErr, setPwdErr] = useState("");
  const [pwdOk, setPwdOk] = useState("");

  // Perfil (editable)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");

  // Read-only
  const email = user?.email || "";
  const dni = user?.dni || "";

  // Cambio contraseña
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Cargar / refrescar user si falta
  useEffect(() => {
    if (!user) {
      setLoading(true);
      setErr("");
      loadMe()
        .unwrap?.()
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronizar form con user cuando cambia
  useEffect(() => {
    if (!user) return;
    setFirstName(user?.first_name || "");
    setLastName(user?.last_name || "");
    setPhone(user?.phone || "");
    setBirthDate(toISODateInput(user?.birth_date));
  }, [user]);

  const canSave = useMemo(() => {
    if (!user) return false;
    // mínimo: permitir guardar incluso con campos vacíos (backend decide)
    return !saving;
  }, [user, saving]);

  const onSave = async (e) => {
    e.preventDefault();
    setErr("");
    setOk("");

    if (!user) return;

    setSaving(true);
    try {
      const patch = {
        first_name: firstName,
        last_name: lastName,
        phone: phone,
        birth_date: birthDate || null,
      };

      await accountApi.updateMe(patch);
      await loadMe(); // refrescar store
      setOk("Perfil actualizado.");
    } catch (e2) {
      setErr(normalizeError(e2));
    } finally {
      setSaving(false);
    }
  };

  const onChangePassword = async (e) => {
    e.preventDefault();
    setPwdErr("");
    setPwdOk("");

    const cur = String(currentPassword || "");
    const next = String(newPassword || "");

    if (!cur) {
      setPwdErr("Ingresá tu contraseña actual.");
      return;
    }
    if (!next || next.length < 8) {
      setPwdErr("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setPwdSaving(true);
    try {
      await accountApi.changeMyPassword({
        current_password: cur,
        new_password: next,
      });
      setPwdOk("Contraseña actualizada.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (e2) {
      setPwdErr(normalizeError(e2));
    } finally {
      setPwdSaving(false);
    }
  };

  const onLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="dash-page">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Mi perfil</h1>
          <p className="dash-sub">Administrá tus datos y tu sesión.</p>
        </div>
      </div>

      {loading ? (
        <div className="dash-card">
          <div className="dash-muted">Cargando…</div>
        </div>
      ) : !user ? (
        <div className="dash-card">
          <div className="dash-alert">No se pudo cargar el perfil.</div>
          <div className="dash-actions">
            <button className="btn-secondary" type="button" onClick={() => navigate("/login")}>
              Ir a login
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Datos personales */}
          <section className="dash-card">
            <div className="dash-card-head">
              <div>
                <div className="dash-kicker">Cuenta</div>
                <h2 className="dash-h2">Datos personales</h2>
              </div>
              <div className="dash-actions">
                <button className="btn-secondary" type="button" onClick={onLogout}>
                  Cerrar sesión
                </button>
              </div>
            </div>

            {err ? <div className="dash-alert">{err}</div> : null}
            {ok ? <div className="dash-alert" style={{ borderColor: "rgba(0,0,0,.1)" }}>{ok}</div> : null}

            <form onSubmit={onSave}>
              <div className="dash-grid">
                <div className="dash-item">
                  <div className="dash-k">DNI</div>
                  <div className="dash-v mono">{dni || "-"}</div>
                </div>

                <div className="dash-item">
                  <div className="dash-k">Email</div>
                  <div className="dash-v">{email || "-"}</div>
                  <div className="dash-muted" style={{ marginTop: 6 }}>
                    El email no se puede editar desde tu perfil.
                  </div>
                </div>

                <div className="dash-item">
                  <label className="dash-k" htmlFor="first_name">Nombre</label>
                  <input
                    id="first_name"
                    className="dash-select"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={saving}
                    placeholder="Tu nombre"
                  />
                </div>

                <div className="dash-item">
                  <label className="dash-k" htmlFor="last_name">Apellido</label>
                  <input
                    id="last_name"
                    className="dash-select"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={saving}
                    placeholder="Tu apellido"
                  />
                </div>

                <div className="dash-item">
                  <label className="dash-k" htmlFor="phone">Teléfono</label>
                  <input
                    id="phone"
                    className="dash-select"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={saving}
                    placeholder="Ej: +54 9 11 1234-5678"
                  />
                </div>

                <div className="dash-item">
                  <label className="dash-k" htmlFor="birth_date">Fecha de nacimiento</label>
                  <input
                    id="birth_date"
                    type="date"
                    className="dash-select"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="dash-actions" style={{ marginTop: 14 }}>
                <button className="btn-primary" type="submit" disabled={!canSave}>
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>

                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => navigate("/dashboard/seguro")}
                  disabled={saving}
                >
                  Volver al panel
                </button>
              </div>
            </form>
          </section>

          {/* Cambio de contraseña */}
          <section className="dash-card">
            <div className="dash-card-head">
              <div>
                <div className="dash-kicker">Seguridad</div>
                <h2 className="dash-h2">Cambiar contraseña</h2>
              </div>
            </div>

            {pwdErr ? <div className="dash-alert">{pwdErr}</div> : null}
            {pwdOk ? <div className="dash-alert" style={{ borderColor: "rgba(0,0,0,.1)" }}>{pwdOk}</div> : null}

            <form onSubmit={onChangePassword}>
              <div className="dash-grid">
                <div className="dash-item">
                  <label className="dash-k" htmlFor="current_password">Contraseña actual</label>
                  <input
                    id="current_password"
                    type="password"
                    className="dash-select"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={pwdSaving}
                    autoComplete="current-password"
                  />
                </div>

                <div className="dash-item">
                  <label className="dash-k" htmlFor="new_password">Nueva contraseña</label>
                  <input
                    id="new_password"
                    type="password"
                    className="dash-select"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={pwdSaving}
                    autoComplete="new-password"
                  />
                  <div className="dash-muted" style={{ marginTop: 6 }}>
                    Mínimo 8 caracteres.
                  </div>
                </div>
              </div>

              <div className="dash-actions" style={{ marginTop: 14 }}>
                <button className="btn-primary" type="submit" disabled={pwdSaving}>
                  {pwdSaving ? "Actualizando…" : "Actualizar contraseña"}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
