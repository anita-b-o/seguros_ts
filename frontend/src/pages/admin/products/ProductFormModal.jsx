// src/pages/admin/products/ProductFormModal.jsx
import { useEffect, useMemo, useState } from "react";
import { adminProductsApi } from "@/services/adminProductsApi";
import "@/styles/adminPolicies.css";

const VEHICLE_TYPES = [
  { value: "AUTO", label: "Auto" },
  { value: "MOTO", label: "Moto" },
  { value: "COM", label: "Comercial" },
];

const PLAN_TYPES = [
  { value: "RC", label: "Responsabilidad Civil" },
  { value: "TC", label: "Terceros Completo" },
  { value: "TR", label: "Todo Riesgo" },
];

function normalizeBullets(text) {
  // acepta textarea con líneas
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines;
}

export default function ProductFormModal({ open, onClose, product, onSaved }) {
  const isEdit = !!product?.id;

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [vehicleType, setVehicleType] = useState("AUTO");
  const [planType, setPlanType] = useState("TR");
  const [minYear, setMinYear] = useState(1995);
  const [maxYear, setMaxYear] = useState(2100);
  const [basePrice, setBasePrice] = useState(0);
  const [franchise, setFranchise] = useState("");
  const [coverages, setCoverages] = useState("");
  const [bulletsText, setBulletsText] = useState("");
  const [publishedHome, setPublishedHome] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [homeOrder, setHomeOrder] = useState(0);

  useEffect(() => {
    if (!open) return;

    setErr("");
    setSaving(false);

    if (!product) {
      setCode("");
      setName("");
      setSubtitle("");
      setVehicleType("AUTO");
      setPlanType("TR");
      setMinYear(1995);
      setMaxYear(2100);
      setBasePrice(0);
      setFranchise("");
      setCoverages("");
      setBulletsText("");
      setPublishedHome(true);
      setIsActive(true);
      setHomeOrder(0);
      return;
    }

    setCode(product.code || "");
    setName(product.name || "");
    setSubtitle(product.subtitle || "");
    setVehicleType(product.vehicle_type || "AUTO");
    setPlanType(product.plan_type || "TR");
    setMinYear(Number(product.min_year ?? 1995));
    setMaxYear(Number(product.max_year ?? 2100));
    setBasePrice(Number(product.base_price ?? 0));
    setFranchise(product.franchise || "");
    setCoverages(product.coverages || "");
    setBulletsText(Array.isArray(product.bullets) ? product.bullets.join("\n") : "");
    setPublishedHome(Boolean(product.published_home));
    setIsActive(Boolean(product.is_active));
    setHomeOrder(Number(product.home_order ?? 0));
  }, [open, product]);

  const payload = useMemo(() => {
    return {
      code: code || null,
      name: name?.trim() || "",
      subtitle: subtitle || "",
      vehicle_type: vehicleType,
      plan_type: planType,
      min_year: Number(minYear || 0),
      max_year: Number(maxYear || 0),
      base_price: Number(basePrice || 0),
      franchise: franchise || "",
      coverages: coverages || "",
      bullets: normalizeBullets(bulletsText),
      published_home: Boolean(publishedHome),
      is_active: Boolean(isActive),
      home_order: Number(homeOrder || 0),
    };
  }, [
    code,
    name,
    subtitle,
    vehicleType,
    planType,
    minYear,
    maxYear,
    basePrice,
    franchise,
    coverages,
    bulletsText,
    publishedHome,
    isActive,
    homeOrder,
  ]);

  const validate = () => {
    if (!payload.name) return "El nombre es obligatorio.";
    if (payload.min_year && payload.max_year && payload.min_year > payload.max_year) {
      return "min_year no puede ser mayor que max_year.";
    }
    return "";
  };

  const onSubmit = async () => {
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    setSaving(true);
    setErr("");
    try {
      if (isEdit) {
        await adminProductsApi.patch(product.id, payload);
      } else {
        await adminProductsApi.create(payload);
      }
      onClose?.();
      onSaved?.();
    } catch (e) {
      setErr("No se pudo guardar el producto.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{isEdit ? "Editar seguro" : "Crear seguro"}</div>
            <div className="modal-sub">
              {isEdit ? (product?.code || product?.name || "") : "Definí el tipo de seguro visible en el Home."}
            </div>
          </div>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="form">
          {err ? <div className="admin-alert">{String(err)}</div> : null}

          <label className="form-label">
            Código (opcional, si lo dejás vacío se autogenera)
            <input className="form-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="RC, TR, TC…" />
          </label>

          <label className="form-label">
            Nombre
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Auto RC" />
          </label>

          <label className="form-label">
            Subtítulo (opcional)
            <input className="form-input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Ej: Responsabilidad Civil (RC)" />
          </label>

          <div className="info-grid">
            <label className="form-label">
              Tipo de vehículo
              <select className="form-input" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                {VEHICLE_TYPES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-label">
              Tipo de plan
              <select className="form-input" value={planType} onChange={(e) => setPlanType(e.target.value)}>
                {PLAN_TYPES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="info-grid">
            <label className="form-label">
              Año mínimo
              <input className="form-input" type="number" value={minYear} onChange={(e) => setMinYear(e.target.value)} />
            </label>

            <label className="form-label">
              Año máximo
              <input className="form-input" type="number" value={maxYear} onChange={(e) => setMaxYear(e.target.value)} />
            </label>
          </div>

          <label className="form-label">
            Precio base
            <input className="form-input" type="number" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
          </label>

          <label className="form-label">
            Franquicia (opcional)
            <input className="form-input" value={franchise} onChange={(e) => setFranchise(e.target.value)} placeholder="Ej: $50.000" />
          </label>

          <label className="form-label">
            Bullets / Features (una por línea)
            <textarea
              className="form-input"
              style={{ height: 110, paddingTop: 10, resize: "vertical" }}
              value={bulletsText}
              onChange={(e) => setBulletsText(e.target.value)}
              placeholder={`Ej:\n- Asistencia 24hs\n- Granizo\n- Robo total`}
            />
          </label>

          <label className="form-label">
            Coberturas (markdown / lista)
            <textarea
              className="form-input"
              style={{ height: 110, paddingTop: 10, resize: "vertical" }}
              value={coverages}
              onChange={(e) => setCoverages(e.target.value)}
              placeholder={`Ej:\n- Responsabilidad civil\n- Robo / hurto\n- Incendio`}
            />
          </label>

          <div className="info-grid">
            <label className="form-label" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={publishedHome} onChange={(e) => setPublishedHome(e.target.checked)} />
              Visible en Home
            </label>

            <label className="form-label" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Activo
            </label>
          </div>

          <label className="form-label">
            Orden en Home (menor = primero)
            <input className="form-input" type="number" value={homeOrder} onChange={(e) => setHomeOrder(e.target.value)} />
          </label>

          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className="btn-primary" type="button" onClick={onSubmit} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
