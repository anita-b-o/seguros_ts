import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import useAuth from "@/hooks/useAuth";
import GoogleLoginButton from "@/components/auth/GoogleLoginButton";
import "@/styles/Login.css";

const EMAIL_PATTERN = /\S+@\S+\.\S+/;

function normalizeFieldErrors(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => `${item}`);
  return [`${value}`];
}

function deriveBackendErrorMessage(responseData) {
  if (!responseData) return "";
  const parts = [];
  if (responseData.detail) parts.push(responseData.detail);
  parts.push(...normalizeFieldErrors(responseData.email));
  parts.push(...normalizeFieldErrors(responseData.password));
  return parts.length ? parts.join(" ") : responseData.error || "";
}

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

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { login } = useAuth();
  const allowGoogle =
    import.meta.env.VITE_ENABLE_GOOGLE === "true" && Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const [form, setForm] = useState({
    email: "",
    password: "",
    remember: true,
    reveal: false,
    otp: "",
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [otpInfo, setOtpInfo] = useState({ phone: "", ttl: 300 });

  const onChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!form.email) return setErr("Ingresá tu email.");
    if (!EMAIL_PATTERN.test(form.email)) return setErr("Ingresá un email válido.");
    if (!form.password) return setErr("Ingresá tu contraseña.");
    if (needOtp && !form.otp) return setErr("Ingresá el código que te enviamos.");

    try {
      setLoading(true);

      // Esperamos que login devuelva el usuario (ya normalizado en AuthProvider)
      const result = await login({
        email: form.email.trim(),
        password: form.password,
        remember: form.remember,
        otp: form.otp || undefined,
      });

      if (result?.require_otp) {
        setNeedOtp(true);
        setOtpInfo({
          phone: result.otp_sent_to || "",
          ttl: result.otp_ttl_seconds || 300,
        });
        setErr(result.detail || "Te enviamos un código a tu WhatsApp. Ingresalo para continuar.");
        return;
      }

      const user = result;

      // Fallback por las dudas (usa tu clave real en LS)
      const lsUser = (() => {
        try { return JSON.parse(localStorage.getItem("sc_user") || "null"); }
        catch { return null; }
      })();

      const admin = isAdminUser(user) || isAdminUser(lsUser);

      // Evitamos que un "from" previo mande a un admin al dashboard de cliente
      const from = loc.state?.from;
      const blocked = new Set(["/", "/login", "/register", "/admin", "/dashboard", "/dashboard/seguro"]);
      const canUseFrom = from && !blocked.has(from);

      const target = admin ? "/admin" : (canUseFrom ? from : "/dashboard/seguro");
      nav(target, { replace: true });
    } catch (e2) {
      const detail = deriveBackendErrorMessage(e2?.response?.data);
      const status = e2?.response?.status;
      const fallbacks = {
        400: "Credenciales inválidas o datos incompletos.",
        401: "Credenciales inválidas.",
        403: "Tu cuenta está inactiva. Contactá al administrador.",
        429: "Demasiados intentos. Esperá unos minutos e intentá nuevamente.",
      };
      const msg = detail || fallbacks[status] || "No pudimos iniciar sesión. Revisá tus datos e intentá nuevamente.";
      setErr(msg);
      if (e2?.response?.data?.require_otp) {
        setNeedOtp(true);
        setOtpInfo({
          phone: e2?.response?.data?.otp_sent_to || "",
          ttl: e2?.response?.data?.otp_ttl_seconds || 300,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main" className="login-page">
      <div className="login-card" role="region" aria-label="Acceso a la cuenta">
        <h1 className="login-title">Iniciar sesión</h1>
        <p className="login-subtitle">Accedé a tus pólizas, pagos y comprobantes.</p>

        {err && (
          <div className="login-alert" role="alert" aria-live="assertive">
            {err}
          </div>
        )}

        <form className="login-form" onSubmit={onSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={form.email}
              onChange={onChange}
              placeholder="usuario@dominio.com"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <div className="password-wrap">
              <input
                id="password"
                name="password"
                type={form.reveal ? "text" : "password"}
                autoComplete="current-password"
                value={form.password}
                onChange={onChange}
                required
                disabled={loading}
              />
              <button
                type="button"
                className="reveal-btn"
                aria-label={form.reveal ? "Ocultar contraseña" : "Mostrar contraseña"}
                onClick={() => setForm((f) => ({ ...f, reveal: !f.reveal }))}
                disabled={loading}
                title={form.reveal ? "Ocultar" : "Mostrar"}
              >
                {form.reveal ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <div className="form-row between">
            <label className="check">
              <input
                type="checkbox"
                name="remember"
                checked={form.remember}
                onChange={(e) =>
                  setForm((f) => ({ ...f, remember: e.target.checked }))
                }
                disabled={loading}
              />
              <span>Recordarme</span>
            </label>

            <Link to="/reset" className="link small">
              Olvidé mi contraseña
            </Link>
          </div>

          {needOtp && (
            <div className="form-group">
              <label htmlFor="otp">Código de verificación</label>
              <input
                id="otp"
                name="otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={form.otp}
                onChange={onChange}
                placeholder="Ej: 123456"
                required
                disabled={loading}
              />
              <small className="hint">
                Te enviamos un código de 6 dígitos a {otpInfo.phone || "tu WhatsApp"}.
                Tiene validez de {Math.round((otpInfo.ttl || 300) / 60)} minutos.
              </small>
            </div>
          )}

          <button
            type="submit"
            className="btn btn--primary login-btn"
            disabled={loading}
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>

          {allowGoogle && (
            <>
              <div className="auth__divider">
                <span>o</span>
              </div>

              <div className="google-login" aria-hidden={loading}>
                <GoogleLoginButton onErrorMessage={setErr} disabled={loading} />
              </div>
            </>
          )}

          <p className="login-register">
            ¿No tenés cuenta?{" "}
            <Link to="/register" className="link">
              Crear cuenta
            </Link>
          </p>
        </form>
      </div>

      <style>{`
        .auth__divider { display:flex; align-items:center; gap:.75rem; color:#666; margin:1rem 0; }
        .auth__divider::before, .auth__divider::after { content:""; flex:1; height:1px; background:#e0e0e0; }
        .google-login { display:flex; justify-content:center; }
      `}</style>
    </main>
  );
}
