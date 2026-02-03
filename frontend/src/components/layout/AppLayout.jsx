import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import useAuth from "@/hooks/useAuth";
import { tokenStorage } from "@/api/tokenStorage";

export default function AppLayout() {
  const { loadMe, status, user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const access = tokenStorage.getAccess();
    if (access && !user && status !== "loading") {
      loadMe();
    }
  }, [loadMe, status, user]);

  return (
    <div className="app-shell">
      <Navbar />
      <main id="main">
        <Outlet />
      </main>
      {!location.pathname.startsWith("/admin") ? <Footer /> : null}
    </div>
  );
}
