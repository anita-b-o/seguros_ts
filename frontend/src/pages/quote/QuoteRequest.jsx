import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiPublic } from "@/api";
import { quotesApi } from "@/services/quotesApi";
import { carCatalogApi } from "@/services/carCatalogApi";
import AsyncAutocomplete from "@/components/forms/AsyncAutocomplete";
import "@/styles/quoteForm.css";

const INSURER_EMAIL =
  import.meta.env.VITE_INSURER_EMAIL || "no-reply@sancayetano.com";
const CONTACT_FALLBACK = {
  whatsapp: import.meta.env.VITE_WA_INSURER_NUMBER || "",
};

function yearsList() {
  const now = new Date().getFullYear();
  return Array.from({ length: 101 }, (_, i) => now - i);
}

const normalizePhone = (v) => String(v || "").replace(/[^\d]/g, "");

export default function QuoteRequest() {
  const [searchParams] = useSearchParams();
  const years = useMemo(yearsList, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [contact, setContact] = useState(CONTACT_FALLBACK);
  const selectedPlanCode = String(searchParams.get("plan") || "").trim();
  const selectedPlanName = String(
    searchParams.get("plan_name") || selectedPlanCode
  ).trim();

  /* =======================
     Campos
  ======================= */
  const [wa, setWa] = useState("");
  const [usage, setUsage] = useState("");

  const [makeLabel, setMakeLabel] = useState("");
  const [makeId, setMakeId] = useState("");
  const [model, setModel] = useState("");
  const [version, setVersion] = useState("");
  const [year, setYear] = useState("");
  const [locality, setLocality] = useState("");
  const [garage, setGarage] = useState("");
  const [gnc, setGnc] = useState("");
  const [gncAmount, setGncAmount] = useState("");

  /* =======================
     Fotos
  ======================= */
  const [photoFront, setPhotoFront] = useState(null);
  const [photoBack, setPhotoBack] = useState(null);
  const [photoRight, setPhotoRight] = useState(null);
  const [photoLeft, setPhotoLeft] = useState(null);

  const refFront = "/illustrations/front-car.png";
  const refBack = "/illustrations/back-car.png";
  const refRight = "/illustrations/right-car.png";
  const refLeft = "/illustrations/left-car.png";

  /* =======================
     Validación
  ======================= */
  const canSubmit =
    normalizePhone(wa).length >= 8 &&
    usage &&
    makeLabel &&
    model &&
    version &&
    year &&
    locality &&
    (garage === "yes" || garage === "no") &&
    (gnc === "yes" || gnc === "no") &&
    (gnc !== "yes" || gncAmount) &&
    photoFront &&
    photoBack &&
    photoRight &&
    photoLeft &&
    !busy;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await apiPublic.get("/common/contact-info");
        if (!mounted) return;
        setContact((prev) => ({ ...prev, ...data }));
      } catch {
        if (!mounted) return;
        setContact(CONTACT_FALLBACK);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /* =======================
     API catálogo
  ======================= */
  const loadMakes = (q) => carCatalogApi.searchMakes(q);
  const loadModels = (q) =>
    makeId ? carCatalogApi.searchModels(makeId, q) : [];
  const loadTrims = (q) =>
    makeId && model ? carCatalogApi.searchTrims(makeId, model, q) : [];

  const onPickMake = async (label) => {
    setMakeLabel(label);
    try {
      const res = await carCatalogApi.searchMakes(label);
      const hit = res.find(
        (m) => m.label.toLowerCase() === label.toLowerCase()
      );
      setMakeId(hit?.value || "");
    } catch {
      setMakeId("");
    }
    setModel("");
    setVersion("");
  };

  /* =======================
     Submit
  ======================= */
  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setShareUrl("");

    if (!canSubmit) {
      setErr("Completá todos los campos obligatorios.");
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      if (selectedPlanCode) fd.append("plan_code", selectedPlanCode);
      if (selectedPlanName) fd.append("plan_name", selectedPlanName);
      fd.append("whatsapp", normalizePhone(wa));
      fd.append("usage", usage);
      fd.append("make", makeLabel);
      fd.append("model", model);
      fd.append("version", version);
      fd.append("year", year);
      fd.append("locality", locality);
      fd.append("garage", garage === "yes");
      fd.append("gnc", gnc === "yes");
      if (gnc === "yes") fd.append("gnc_amount", gncAmount);

      fd.append("photo_front", photoFront);
      fd.append("photo_back", photoBack);
      fd.append("photo_right", photoRight);
      fd.append("photo_left", photoLeft);

      const data = await quotesApi.createShare(fd);
      const url =
        data?.url ||
        (data?.token
          ? `${window.location.origin}/quote/share/${data.token}`
          : "");

      if (!url) throw new Error("No se pudo generar el link.");

      setShareUrl(url);

      const msg = `Hola, estoy interesado en cotizar mi vehículo. Estos son mis datos: ${url}`;
      const insurerWa = String(contact.whatsapp || "").replace(/\D/g, "");
      const waLink = insurerWa
        ? `https://wa.me/${insurerWa}?text=${encodeURIComponent(msg)}`
        : "";

      if (!waLink) {
        throw new Error("No hay un WhatsApp de contacto configurado.");
      }

      window.open(waLink, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e?.message || "Error al enviar la cotización.");
    } finally {
      setBusy(false);
    }
  };

  /* =======================
     Render
  ======================= */
  return (
    <div className="quote-page">
      <div className="quote-card">
        <h1 className="quote-title">Solicitar cotización</h1>
        <p className="quote-sub">
          Ingresá tus datos y abriremos WhatsApp con tu ficha completa.
        </p>

        {selectedPlanName ? (
          <div className="quote-plan-banner" aria-label="Plan seleccionado">
            <span className="quote-plan-banner__label">Plan seleccionado</span>
            <strong className="quote-plan-banner__value">{selectedPlanName}</strong>
          </div>
        ) : null}

        {err && <div className="quote-alert">{err}</div>}

        <form className="quote-form" onSubmit={onSubmit}>
          {/* WhatsApp */}
          <label className="form-label">
            <span className="label-inline">
              Número de WhatsApp <span className="req">*</span>
            </span>
            <input
              className="form-input"
              value={wa}
              onChange={(e) => setWa(e.target.value)}
              placeholder="Ej: 221 123 4567"
              disabled={busy}
              required
            />
          </label>

          {/* Marca / Modelo */}
          <div className="grid2">
            <AsyncAutocomplete
              label="Marca"
              required
              value={makeLabel}
              onChange={onPickMake}
              loadOptions={loadMakes}
              disabled={busy}
              placeholder="Elegí o escribí la marca"
              hint="Podés escribir libre si no aparece."
            />

            <AsyncAutocomplete
              label="Modelo"
              required
              value={model}
              onChange={(v) => {
                setModel(v);
                setVersion("");
              }}
              loadOptions={loadModels}
              disabled={busy || !makeId}
              placeholder={
                makeId
                  ? "Elegí o escribí el modelo"
                  : "Primero elegí una marca"
              }
            />
          </div>

          {/* Versión */}
          <AsyncAutocomplete
            label="Versión"
            required
            value={version}
            onChange={setVersion}
            loadOptions={loadTrims}
            disabled={busy || !makeId || !model}
            placeholder="Elegí o escribí la versión"
            hint="Si no coincide, podés dejar lo escrito."
          />

          {/* Año / Localidad */}
          <div className="grid2">
            <label className="form-label">
              <span className="label-inline">
                Año <span className="req">*</span>
              </span>
              <select
                className="form-input"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                disabled={busy}
                required
              >
                <option value="">Elegí el año</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-label">
              <span className="label-inline">
                Localidad <span className="req">*</span>
              </span>
              <input
                className="form-input"
                value={locality}
                onChange={(e) => setLocality(e.target.value)}
                disabled={busy}
                required
              />
            </label>
          </div>

          {/* Garage / Uso / GNC */}
          <div className="grid2">
            <SelectReq
              label="¿Lo guarda en garaje?"
              value={garage}
              onChange={setGarage}
              disabled={busy}
            />
            <SelectReq
              label="Uso del vehículo"
              value={usage}
              onChange={setUsage}
              disabled={busy}
              options={[
                ["privado", "Privado"],
                ["comercial", "Comercial"],
              ]}
            />
            <SelectReq
              label="¿Es a GNC?"
              value={gnc}
              onChange={(v) => {
                setGnc(v);
                if (v !== "yes") setGncAmount("");
              }}
              disabled={busy}
            />
          </div>

          {gnc === "yes" && (
            <label className="form-label">
              <span className="label-inline">
                Monto GNC <span className="req">*</span>
              </span>
              <input
                className="form-input"
                value={gncAmount}
                onChange={(e) => setGncAmount(e.target.value)}
                disabled={busy}
                required
              />
            </label>
          )}

          {/* Fotos */}
          <h2 className="quote-h2">Fotos del vehículo</h2>
          <div className="photos">
            <PhotoField title="Foto adelante" refImg={refFront} file={photoFront} setFile={setPhotoFront} />
            <PhotoField title="Foto atrás" refImg={refBack} file={photoBack} setFile={setPhotoBack} />
            <PhotoField title="Foto derecha" refImg={refRight} file={photoRight} setFile={setPhotoRight} />
            <PhotoField title="Foto izquierda" refImg={refLeft} file={photoLeft} setFile={setPhotoLeft} />
          </div>

          <button className="quote-submit" disabled={!canSubmit}>
            {busy ? "Enviando…" : "Enviar por WhatsApp"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* =======================
   Helpers
======================= */

function SelectReq({ label, value, onChange, disabled, options }) {
  const opts =
    options ||
    [
      ["yes", "Sí"],
      ["no", "No"],
    ];

  return (
    <label className="form-label">
      <span className="label-inline">
        {label} <span className="req">*</span>
      </span>
      <select
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
      >
        <option value="">Elegí una opción</option>
        {opts.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

function PhotoField({ title, refImg, file, setFile }) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="photo-card">
      <div className="photo-title">{title} *</div>
      <img src={refImg} alt={title} className="photo-ref" />
      {preview && <img src={preview} alt="preview" className="photo-preview" />}
      <input
        type="file"
        accept="image/*"
        required
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
    </div>
  );
}
