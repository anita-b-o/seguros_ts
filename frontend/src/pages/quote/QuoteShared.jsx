import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { quotesApi } from "@/services/quotesApi";
import "@/styles/quoteShared.css";

const PHOTO_LABELS = {
  front: "Frontal",
  back: "Trasera",
  right: "Lateral derecha",
  left: "Lateral izquierda",
};

function formatDate(value) {
  if (!value) return "Sin vencimiento";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "No informado";
  return `+${digits}`;
}

function formatUsage(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "No informado";
  const map = {
    particular: "Particular",
    privado: "Particular",
    comercial: "Comercial",
    trabajo: "Trabajo",
    uber: "Uso intensivo",
    taxi: "Taxi / Remis",
  };
  return map[raw] || raw.charAt(0).toUpperCase() + raw.slice(1);
}

function yesNo(value) {
  return value ? "Sí" : "No";
}

export default function QuoteShared() {
  const { token } = useParams();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await quotesApi.getShare(token);
        if (!mounted) return;
        setQuote(data);
      } catch (err) {
        if (!mounted) return;
        const detail =
          err?.response?.data?.detail ||
          err?.message ||
          "No se pudo cargar la cotización compartida.";
        setError(detail);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  const photoEntries = useMemo(() => {
    const photos = quote?.photos || {};
    return Object.entries(PHOTO_LABELS)
      .map(([key, label]) => ({ key, label, url: photos[key] || "" }))
      .filter((item) => item.url);
  }, [quote]);

  if (loading) {
    return (
      <section className="quote-shared">
        <div className="quote-shared__shell">
          <div className="quote-shared__status">Cargando cotización…</div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="quote-shared">
        <div className="quote-shared__shell">
          <div className="quote-shared__status quote-shared__status--error">
            {error}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="quote-shared">
      <div className="quote-shared__shell">
        <header className="quote-shared__hero">
          <div>
            <p className="quote-shared__eyebrow">Ficha compartida</p>
            <h1 className="quote-shared__title">
              {quote?.plan_name || "Cotización de vehículo"}
            </h1>
            <p className="quote-shared__subtitle">
              Datos cargados por el cliente para revisión comercial.
            </p>
          </div>

          <div className="quote-shared__metaCard">
            <div className="quote-shared__metaLabel">Token</div>
            <div className="quote-shared__metaValue">{quote?.token || token}</div>
            <div className="quote-shared__metaLabel">Creada</div>
            <div className="quote-shared__metaValue">
              {formatDate(quote?.created_at)}
            </div>
            <div className="quote-shared__metaLabel">Vence</div>
            <div className="quote-shared__metaValue">
              {formatDate(quote?.expires_at)}
            </div>
          </div>
        </header>

        <div className="quote-shared__grid">
          <article className="quote-shared__card">
            <h2>Vehículo</h2>
            <dl className="quote-shared__facts">
              <div>
                <dt>Marca</dt>
                <dd>{quote?.make || "No informado"}</dd>
              </div>
              <div>
                <dt>Modelo</dt>
                <dd>{quote?.model || "No informado"}</dd>
              </div>
              <div>
                <dt>Versión</dt>
                <dd>{quote?.version || "No informado"}</dd>
              </div>
              <div>
                <dt>Año</dt>
                <dd>{quote?.year || "No informado"}</dd>
              </div>
              <div>
                <dt>Localidad</dt>
                <dd>{quote?.city || "No informado"}</dd>
              </div>
              <div>
                <dt>Uso</dt>
                <dd>{formatUsage(quote?.usage)}</dd>
              </div>
            </dl>
          </article>

          <article className="quote-shared__card">
            <h2>Condiciones</h2>
            <dl className="quote-shared__facts">
              <div>
                <dt>WhatsApp del cliente</dt>
                <dd>{formatPhone(quote?.phone)}</dd>
              </div>
              <div>
                <dt>Cochera</dt>
                <dd>{yesNo(quote?.has_garage)}</dd>
              </div>
              <div>
                <dt>GNC</dt>
                <dd>{yesNo(quote?.has_gnc)}</dd>
              </div>
              <div>
                <dt>Monto GNC</dt>
                <dd>
                  {quote?.has_gnc && quote?.gnc_amount
                    ? `$ ${quote.gnc_amount}`
                    : "No aplica"}
                </dd>
              </div>
              <div>
                <dt>Plan</dt>
                <dd>{quote?.plan_name || quote?.plan_code || "Sin plan"}</dd>
              </div>
            </dl>
          </article>
        </div>

        <article className="quote-shared__card quote-shared__galleryCard">
          <div className="quote-shared__sectionHead">
            <div>
              <p className="quote-shared__eyebrow">Inspección visual</p>
              <h2>Fotos del vehículo</h2>
            </div>
            <div className="quote-shared__photoCount">
              {photoEntries.length} imagen{photoEntries.length === 1 ? "" : "es"}
            </div>
          </div>

          <div className="quote-shared__gallery">
            {photoEntries.map((photo) => (
              <figure key={photo.key} className="quote-shared__photo">
                <img src={photo.url} alt={photo.label} loading="lazy" />
                <figcaption>{photo.label}</figcaption>
              </figure>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
