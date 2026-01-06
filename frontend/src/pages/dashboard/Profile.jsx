import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { USERS_ME } from "@/api/endpoints";
import useAuth from "@/hooks/useAuth";
import LogoutButton from "@/components/auth/LogoutButton";
import "../../styles/profile.css";

export default function Profile() {
  const { user, setSession } = useAuth();
  const [form, setForm] = useState({
    first_name: user?.first_name || "",
    last_name: user?.last_name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    dni: user?.dni || "",
    birth_date: user?.birth_date || user?.dob || "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get(USERS_ME);
        if (!mounted) return;
        setForm({
          first_name: data.first_name || "",
          last_name: data.last_name || "",
          email: data.email || "",
          phone: data.phone || "",
          dni: data.dni || "",
          birth_date: data.birth_date || data.dob || "",
        });
      } catch (err) {
        setError("No se pudo cargar tu perfil. Intentá nuevamente.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
    setError("");
  }

  const isDirty = useMemo(() => {
    if (!user) return true;
    return (
      (form.first_name || "") !== (user.first_name || "") ||
      (form.last_name || "") !== (user.last_name || "") ||
      (form.email || "") !== (user.email || "") ||
      (form.phone || "") !== (user.phone || "") ||
      (form.dni || "") !== (user.dni || "") ||
      (form.birth_date || "") !== (user.birth_date || user.dob || "")
    );
  }, [form, user]);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, birth_date: form.birth_date || null };
      const { data } = await api.put(USERS_ME, payload);
      setSession({ user: { ...user, ...data } });
      setSaved(true);
    } catch (err) {
      setError(
        "No se pudieron guardar los cambios. Revisá los datos e intentá otra vez."
      );
    } finally {
      setSaving(false);
    }
  }

  const initials = useMemo(() => {
    const fn = (form.first_name || "").trim();
    const ln = (form.last_name || "").trim();
    return `${fn?.[0] || ""}${ln?.[0] || ""}`.toUpperCase();
  }, [form.first_name, form.last_name]);

  const dobValue = form.birth_date ? form.birth_date.slice(0, 10) : "";

  return (
    <section className="policies-page user-page profile-page">
      {/* Encabezado de página, igual criterio que Payments / Overview */}
      <header className="user-page__header">
        <div>
          <h1 className="user-page__title">Mi perfil</h1>
          <p className="user-page__subtitle">
            Gestioná tus datos personales vinculados a tu cuenta.
          </p>
        </div>
      </header>

      <div className="profile-card user-card">
        <div className="card-header">
          <div className="avatar" aria-hidden>
            <span>{initials || "U"}</span>
          </div>
          <div className="title-wrap">
            <h2 className="card-title">Datos personales</h2>
            <p className="card-subtitle">
              Esta información se utiliza para tus pólizas y comprobantes.
            </p>
          </div>
        </div>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="skeleton-grid" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-row" />
            ))}
          </div>
        ) : (
          <form className="profile-form" onSubmit={onSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="first_name">Nombre</label>
                <input
                  id="first_name"
                  name="first_name"
                  type="text"
                  value={form.first_name}
                  onChange={(e) => setField("first_name", e.target.value)}
                  placeholder="Ej: Ana"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="last_name">Apellido</label>
                <input
                  id="last_name"
                  name="last_name"
                  type="text"
                  value={form.last_name}
                  onChange={(e) => setField("last_name", e.target.value)}
                  placeholder="Ej: García"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="email">Correo electrónico</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="tuemail@correo.com"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="phone">Teléfono</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="Ej: 11 2345-6789"
                />
              </div>

              <div className="field">
                <label htmlFor="dni">DNI</label>
                <input
                  id="dni"
                  name="dni"
                  type="text"
                  value={form.dni}
                  disabled
                  readOnly
                />
              </div>

              <div className="field">
                <label htmlFor="birth_date">Fecha de nacimiento</label>
                <input
                  id="birth_date"
                  name="birth_date"
                  type="date"
                  value={dobValue}
                  onChange={(e) => setField("birth_date", e.target.value)}
                />
              </div>
            </div>

            <div className="actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !isDirty}
              >
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
              {saved && !saving && (
                <span className="saved-indicator" aria-live="polite">
                  Cambios guardados
                </span>
              )}
            </div>
          </form>
        )}

        <div className="profile-actions">
          <div className="profile-actions__text">
            <p className="card-subtitle">¿Querés cerrar tu sesión?</p>
            <p className="hint">Podés volver a ingresar con tus credenciales cuando quieras.</p>
          </div>
          <LogoutButton className="btn btn-primary" />
        </div>
      </div>
    </section>
  );
}
