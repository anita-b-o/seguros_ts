// src/pages/Home.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Hero from "@/components/home/Hero";
import PlansSection from "@/components/home/PlansSection";
import HowItWorks from "@/components/home/HowItWorks";
import ContactSection from "@/components/home/ContactSection";
import "@/styles/Home.css";
import { apiPublic } from "@/api";

export default function Home() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      setErr("");
      setTypes([]);
      const normalize = (data = []) =>
        data.map((it) => {
          return {
            id: it.id,
            code: it.code || it.short || it.plan_type || it.id || "",
            name: it.name || it.title || "",
            subtitle: typeof it.subtitle === "string" ? it.subtitle : "",
            features: Array.isArray(it.features)
              ? it.features.filter((x) => String(x).trim())
              : Array.isArray(it.bullets)
              ? it.bullets.filter((x) => String(x).trim())
              : [],
          };
        });

      try {
        // Preferimos productos reales gestionados por el admin
        // Llamamos al backend real (el baseURL ya incluye /api)
        const { data } = await apiPublic.get("/products/home");
        const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
        if (list.length) {
          setTypes(normalize(list));
          return;
        }
        // Fallback alternativo
        const { data: alt } = await apiPublic.get("/products");
        const listAlt = Array.isArray(alt) ? alt : Array.isArray(alt?.results) ? alt.results : [];
        if (listAlt.length) {
          setTypes(normalize(listAlt));
          return;
        }
        setErr("No hay seguros publicados todavía.");
      } catch {
        setErr("No se pudieron cargar los seguros. Reintentá en unos segundos.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleQuote = (plan) => {
    const qs = new URLSearchParams({
      plan: plan.code || plan.name || "",
      plan_name: plan.name || plan.code || "",
    }).toString();
    navigate(`/quote?${qs}`);
  };

  return (
    <div className="home">
      <Hero />

      <PlansSection plans={types} loading={loading} onQuote={handleQuote} />
      {!loading && err && (
        <div className="container">
          <p className="muted" style={{ marginTop: 8 }}>{err}</p>
        </div>
      )}
      <HowItWorks />
      <ContactSection />
    </div>
  );
}
