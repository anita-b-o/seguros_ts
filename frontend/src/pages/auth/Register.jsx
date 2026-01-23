import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";

import useAuth from "@/hooks/useAuth";
import { authApi } from "@/api/authApi";
import "@/styles/auth.css";

const googleEnabled =
  import.meta.env.VITE_ENABLE_GOOGLE === "true" &&
  Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

function isAdult(birthDate) {
  if (!birthDate) return false;

  const today = new Date();
  const birth = new Date(birthDate);

  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 18;
}

export default function Register() {
  const navigate = useNavigate();
  const { user, status, error, clearError, register, googleLogin, loadMe } = useAuth();

  const [dni, setDni] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [googleAvail, setGoogleAvail] = useState(null);

  const [formError, setFormError] = useState(null);

  const isBusy = status === "loading";

  useEffect(() => {
    if (user) navigate("/dashboard/seguro", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (!googleEnabled) {
      setGoogleAvail(false);
      return;
    }

    (async () => {
      try {
        const st = await authApi.googleStatus();
        if (st && typeof st === "object") {
          const enabled = !!(
            st.google_auth_available ??
            st.google_login_enabled ??
            st.google_client_id_configured
          );
          setGoogleAvail(enabled);
        }
      } catch {
        setGoogleAvail(null);
      }
    })();
  }, []);

  const passwordMismatch = password && password2 && password !== password2;

  const underage = useMemo(() => {
    if (!birthDate) return false;
    return !isAdult(birthDate);
  }, [birthDate]);

  const underageMessage = "Debés ser mayor de 18 años para registrarte.";

  const onSubmit = async (e) => {
    e.preventDefault();
    clearError();
    setFormError(null);

    if (passwordMismatch) return;

    if (!birthDate) {
      setFormError("Ingresá tu fecha de nacimiento.");
      return;
    }
    if (!isAdult(birthDate)) {
      setFormError(underageMessage);
      return;
    }

    const payload = {
      dni,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      birth_date: birthDate,
      password,
    };

    const res = await register(payload);
    if (res.meta.requestStatus !== "fulfilled") return;

    // si el backend auto-loguea (no siempre), hidratamos
    const me = await loadMe();
    if (me.meta.requestStatus === "fulfilled") {
      navigate("/dashboard/seguro", { replace: true });
      return;
    }

    navigate("/login", { replace: true });
  };

  const onGoogleSuccess = async (cred) => {
    clearError();
    setFormError(null);

    const idToken = cred?.credential;
    if (!idToken) return;

    const res = await googleLogin({ idToken });
    if (res.meta.requestStatus !== "fulfilled") return;

    const me = await loadMe();
    if (me.meta.requestStatus === "fulfilled") {
      navigate("/dashboard/seguro", { replace: true });
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Crear cuenta</h1>
        <p className="auth-subtitle">Registrate para gestionar tus pólizas, pagos y comprobantes.</p>

        {formError ? (
          <div className="auth-alert" role="alert">
            {String(formError)}
          </div>
        ) : error ? (
          <div className="auth-alert" role="alert">
            {String(error)}
          </div>
        ) : null}

        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-grid">
            <label className="auth-label">
              DNI
              <input
                className="auth-input"
                inputMode="numeric"
                placeholder="Ej: 99000001"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                required
                disabled={isBusy}
              />
            </label>

            <label className="auth-label">
              Teléfono
              <input
                className="auth-input"
                inputMode="tel"
                placeholder="Ej: 221 555-5555"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={isBusy}
              />
            </label>
          </div>

          <div className="auth-grid">
            <label className="auth-label">
              Nombre
              <input
                className="auth-input"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                disabled={isBusy}
              />
            </label>

            <label className="auth-label">
              Apellido
              <input
                className="auth-input"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                disabled={isBusy}
              />
            </label>
          </div>

          <label className="auth-label">
            Fecha de nacimiento
            <input
              className={`auth-input ${underage ? "is-invalid" : ""}`}
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
              disabled={isBusy}
            />
          </label>

          {underage ? (
            <p className="auth-muted" role="status">
              {underageMessage}
            </p>
          ) : null}

          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="usuario@dominio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isBusy}
            />
          </label>

          <div className="auth-grid">
            <label className="auth-label">
              Contraseña
              <input
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isBusy}
              />
            </label>

            <label className="auth-label">
              Repetir contraseña
              <input
                className={`auth-input ${passwordMismatch ? "is-invalid" : ""}`}
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                disabled={isBusy}
              />
            </label>
          </div>

          {passwordMismatch ? (
            <p className="auth-muted" role="status">
              Las contraseñas no coinciden.
            </p>
          ) : null}

          <button className="auth-submit" type="submit" disabled={isBusy || passwordMismatch || underage}>
            {isBusy ? "Creando…" : "Crear cuenta"}
          </button>
        </form>

        <div className="auth-divider" aria-hidden="true">
          o
        </div>

        {!googleEnabled ? (
          <p className="auth-muted">
            El registro con Google no está habilitado (configurá{" "}
            <strong>VITE_ENABLE_GOOGLE</strong> y <strong>VITE_GOOGLE_CLIENT_ID</strong>).
          </p>
        ) : googleAvail === false ? (
          <p className="auth-muted">El registro con Google no está disponible en esta instancia.</p>
        ) : (
          <div className="auth-google">
            <GoogleLogin onSuccess={onGoogleSuccess} onError={() => {}} useOneTap={false} />
          </div>
        )}

        <p className="auth-footer">
          ¿Ya tenés cuenta? <Link to="/login">Ingresar</Link>
        </p>
      </div>
    </div>
  );
}
