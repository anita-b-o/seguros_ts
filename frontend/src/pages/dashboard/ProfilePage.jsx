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

  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // Perfil (editable)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dni, setDni] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");

  // Read-only
  const email = user?.email || "";

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
    setDni(user?.dni || "");
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
        dni: dni || null,
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
                <label className="dash-k" htmlFor="dni">DNI</label>
                <input
                  id="dni"
                  className="dash-select mono"
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  disabled={saving}
                  placeholder="Ingresá tu DNI"
                />
              </div>

              <div className="dash-item">
                <div className="dash-k">Email</div>
                <div className="dash-v">{email || "-"}</div>
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
      )}
    </div>
  );
}
