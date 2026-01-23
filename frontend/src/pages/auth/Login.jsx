import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";

import useAuth from "@/hooks/useAuth";
import { authApi } from "@/api/authApi";
import "@/styles/auth.css";

const googleEnabled =
  import.meta.env.VITE_ENABLE_GOOGLE === "true" &&
  Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export default function Login() {
  const navigate = useNavigate();
  const {
    user,
    status,
    error,
    clearError,
    login,
    googleLogin,
    loadMe,
    otp_required,
    setOtpRequired,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [otpCode, setOtpCode] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);

  const [googleAvail, setGoogleAvail] = useState(null);

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
        } else {
          setGoogleAvail(null);
        }
      } catch {
        setGoogleAvail(null);
      }
    })();
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    clearError();

    // Paso 2: enviar OTP junto a email/password
    if (otp_required) {
      const res = await login({ email, password, otp: otpCode, remember });
      if (res.meta.requestStatus !== "fulfilled") return;

      const me = await loadMe();
      if (me.meta.requestStatus === "fulfilled") {
        navigate("/dashboard/seguro", { replace: true });
      }
      return;
    }

    // Paso 1: login normal (puede devolver require_otp)
    const res = await login({ email, password, remember });
    if (res.meta.requestStatus !== "fulfilled") return;

    // Si el backend respondió 202 (require_otp), no intentamos /me todavía
    if (res.payload?.require_otp || res.payload?.otp_required) {
      setOtpRequired(true);
      return;
    }

    // Si ya hay tokens, hidratamos
    const me = await loadMe();
    if (me.meta.requestStatus === "fulfilled") {
      navigate("/dashboard/seguro", { replace: true });
    }
  };

  const onGoogleSuccess = async (cred) => {
    clearError();
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
        <h1 className="auth-title">Iniciar sesión</h1>
        <p className="auth-subtitle">Accedé a tus pólizas, pagos y comprobantes.</p>

        {error ? (
          <div className="auth-alert" role="alert">
            {String(error)}
          </div>
        ) : null}

        <form className="auth-form" onSubmit={onSubmit}>
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
              disabled={isBusy || otp_required}
            />
          </label>

          {!otp_required ? (
            <>
              <label className="auth-label">
                Contraseña
                <div className="auth-password">
                  <input
                    className="auth-input"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isBusy}
                  />
                  <button
                    type="button"
                    className="auth-eye"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
                    disabled={isBusy}
                  >
                    {showPw ? "🙈" : "👁️"}
                  </button>
                </div>
              </label>

              <div className="auth-row">
                <label className="auth-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    disabled={isBusy}
                  />
                  Recordarme
                </label>

                <Link className="auth-linklike" to="/reset">
                  Olvidé mi contraseña
                </Link>
              </div>

              <button className="auth-submit" type="submit" disabled={isBusy}>
                {isBusy ? "Ingresando…" : "Ingresar"}
              </button>
            </>
          ) : (
            <>
              <label className="auth-label">
                Código OTP
                <input
                  className="auth-input"
                  inputMode="numeric"
                  placeholder="Ej: 123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                  disabled={isBusy}
                />
              </label>

              <button className="auth-submit" type="submit" disabled={isBusy}>
                {isBusy ? "Verificando…" : "Verificar OTP"}
              </button>

              <button
                type="button"
                className="auth-linklike"
                onClick={() => {
                  setOtpRequired(false);
                  setOtpCode("");
                }}
                disabled={isBusy}
              >
                Volver
              </button>
            </>
          )}
        </form>

        <div className="auth-divider" aria-hidden="true">
          o
        </div>

        {!googleEnabled ? (
          <p className="auth-muted">
            El ingreso con Google no está habilitado (configurá{" "}
            <strong>VITE_ENABLE_GOOGLE</strong> y <strong>VITE_GOOGLE_CLIENT_ID</strong>).
          </p>
        ) : googleAvail === false ? (
          <p className="auth-muted">El ingreso con Google no está disponible en esta instancia.</p>
        ) : (
          <div className="auth-google">
            <GoogleLogin onSuccess={onGoogleSuccess} onError={() => {}} useOneTap={false} />
          </div>
        )}

        <p className="auth-footer">
          ¿No tenés cuenta? <Link to="/register">Crear cuenta</Link>
        </p>
      </div>
    </div>
  );
}
