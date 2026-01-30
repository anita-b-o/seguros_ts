import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import useAuth from "@/hooks/useAuth";
import "./navbar.css";

// Normaliza distintas formas de marcar admin
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

/**
 * Navbar accesible:
 * - <header> y <nav> semánticos
 * - "Skip to content" link
 * - Menú móvil con aria-expanded y aria-controls
 * - Cierra con ESC, clic fuera o al navegar
 */
export default function Navbar() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const isLoggedIn = !!user;
  const isAdmin = isAdminUser(user);
  const [activeSection, setActiveSection] = useState("inicio");
  const [pendingAnchor, setPendingAnchor] = useState(null);

  // Sección activa en home por scroll
  useEffect(() => {
    if (pathname !== "/") return;
    const sectionIds = ["planes", "como-funciona", "contacto"];

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -50% 0px", threshold: [0.25, 0.4, 0.6] }
    );

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    const onScroll = () => {
      const first = document.getElementById(sectionIds[0]);
      if (first && first.getBoundingClientRect().top > 120) {
        setActiveSection("inicio");
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  // Cerrar con ESC
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    const onClick = (e) => {
      if (!open) return;
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  const isActive = (key) => {
    if (key === "cotizar") return pathname.startsWith("/quote");
    if (key === "ingresar") return pathname === "/login" || pathname === "/register";

    // Cliente (dashboard)
    if (key === "client-home") return pathname === "/dashboard" || pathname === "/dashboard/seguro";
    if (key === "client-receipts") return pathname.startsWith("/dashboard/receipts");
    if (key === "client-associate") return pathname.startsWith("/dashboard/associate-policy");
    if (key === "client-profile") return pathname.startsWith("/dashboard/profile");

    // Admin (por secciones)
    if (key === "admin-home") return pathname === "/admin/home";
    if (key === "admin-policies") return pathname.startsWith("/admin/policies");
    if (key === "admin-users") return pathname.startsWith("/admin/users");
    if (key === "admin-products") return pathname.startsWith("/admin/products");

    if (pathname === "/") {
      if (["inicio", "planes", "como-funciona", "contacto"].includes(key)) {
        return activeSection === key;
      }
    }
    if (key === "inicio") return pathname === "/";
    return false;
  };

  const linkClass = (key) => (isActive(key) ? "nav__link is-active" : "nav__link");

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: y, behavior: "smooth" });
      setActiveSection(id);
    }
  };

  useEffect(() => {
    if (pathname === "/" && pendingAnchor) {
      const id = pendingAnchor;
      requestAnimationFrame(() => scrollToSection(id));
      setPendingAnchor(null);
    }
  }, [pathname, pendingAnchor]);

  const handleAnchor = (e, id) => {
    e.preventDefault();
    if (pathname !== "/") {
      setPendingAnchor(id);
      navigate("/");
    } else {
      scrollToSection(id);
    }
    setOpen(false);
  };

  // Tu router redirige /dashboard -> /dashboard/seguro, así que esto es OK.
  const clientDashboardHomeTo = "/dashboard";

  return (
    <header className="site-header">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>

      <div className="nav container">
        {/* Logo */}
        <div className="nav__brand">
          <Link to="/" className="nav__logo" aria-label="Ir al inicio">
            <img
              src="/brand/tsblanco.png"
              alt="San Cayetano Seguros"
              className="nav__brand-img"
            />
          </Link>
        </div>

        {/* Botón hamburguesa */}
        <button
          ref={btnRef}
          className="nav__toggle btn--ghost"
          aria-controls="primary-menu"
          aria-expanded={open ? "true" : "false"}
          aria-label="Abrir menú"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 6h18M3 12h18M3 18h18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Navegación principal */}
        <nav className="nav__menu" aria-label="Principal">
          <ul
            id="primary-menu"
            ref={menuRef}
            className={`nav__list ${open ? "is-open" : ""}`}
            onClick={(e) => {
              if (e.target.tagName === "A" || e.target.tagName === "BUTTON") {
                setOpen(false);
              }
            }}
          >
            {/* =========================
                Cliente (no admin)
               ========================= */}
            {!isAdmin && (
              <>
                {/* Si está LOGUEADO: ocultar público y mostrar solo dashboard */}
                {isLoggedIn ? (
                  <>
                    <li>
                      <NavLink to={clientDashboardHomeTo} className={linkClass("client-home")}>
                        Mi panel
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/dashboard/receipts" className={linkClass("client-receipts")}>
                        Comprobantes
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/dashboard/associate-policy" className={linkClass("client-associate")}>
                        Asociar póliza
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/dashboard/profile" className={linkClass("client-profile")}>
                        Perfil
                      </NavLink>
                    </li>
                  </>
                ) : (
                  <>
                    {/* Si NO está logueado: menú público */}
                    <li>
                      <Link
                        to="/#hero"
                        className={linkClass("inicio")}
                        onClick={(e) => handleAnchor(e, "hero")}
                      >
                        Inicio
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/#planes"
                        className={linkClass("planes")}
                        onClick={(e) => handleAnchor(e, "planes")}
                      >
                        Ver planes
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/#como-funciona"
                        className={linkClass("como-funciona")}
                        onClick={(e) => handleAnchor(e, "como-funciona")}
                      >
                        Cómo funciona
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/#contacto"
                        className={linkClass("contacto")}
                        onClick={(e) => handleAnchor(e, "contacto")}
                      >
                        Contacto
                      </Link>
                    </li>

                    <li>
                      <NavLink to="/quote" className={linkClass("cotizar")}>
                        Cotizar
                      </NavLink>
                    </li>

                    <li className="nav__cta">
                      <NavLink
                        to="/login"
                        className={
                          isActive("ingresar")
                            ? "btn btn--secondary is-active"
                            : "btn btn--secondary"
                        }
                      >
                        Ingresar
                      </NavLink>
                    </li>
                  </>
                )}
              </>
            )}

            {/* =========================
                Admin
               ========================= */}
            {isAdmin && (
              <>
                <li>
                  <NavLink to="/admin/home" className={linkClass("admin-home")}>
                    Admin Home
                  </NavLink>
                </li>

                <li>
                  <NavLink to="/admin/policies" className={linkClass("admin-policies")}>
                    Pólizas
                  </NavLink>
                </li>

                <li>
                  <NavLink to="/admin/users" className={linkClass("admin-users")}>
                    Usuarios
                  </NavLink>
                </li>

                <li>
                  <NavLink to="/admin/products" className={linkClass("admin-products")}>
                    Productos
                  </NavLink>
                </li>
              </>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}
