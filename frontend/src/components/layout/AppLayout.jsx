import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import useAuth from "@/hooks/useAuth";

export default function AppLayout() {
  const { loadMe, status, user } = useAuth();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");
  const isQuoteSharedRoute = location.pathname.startsWith("/quote/share/");
  const showChrome = !isQuoteSharedRoute;

  useEffect(() => {
    if (!user && status === "idle") {
      loadMe({ silent: true });
    }
  }, [loadMe, status, user]);

  return (
    <div className="app-shell">
      {showChrome ? <Navbar /> : null}
      <main id="main" className="app-main">
        <Outlet />
      </main>
      {showChrome && !isAdminRoute ? <Footer /> : null}
    </div>
  );
}
