// src/pages/admin/products/ProductFormModal.jsx
import { useEffect, useMemo, useState } from "react";
import { adminProductsApi } from "@/services/adminProductsApi";
import "@/styles/adminPolicies.css";

function normalizeBullets(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function ProductFormModal({ open, onClose, product, onSaved }) {
  const isEdit = !!product?.id;

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [characteristics, setCharacteristics] = useState("");
  const [publishedHome, setPublishedHome] = useState(true);

  useEffect(() => {
    if (!open) return;

    setErr("");
    setSaving(false);

    if (!product) {
      setName("");
      setDescription("");
      setCharacteristics("");
      setPublishedHome(true);
      return;
    }

    setName(product.name || "");
    setDescription(product.subtitle || "");
    setCharacteristics(Array.isArray(product.bullets) ? product.bullets.join("\n") : "");
    setPublishedHome(Boolean(product.published_home));
  }, [open, product]);

  const payload = useMemo(() => {
    const base = {
      name: name.trim(),
      subtitle: description.trim(),
      bullets: normalizeBullets(characteristics),
    };

    if (isEdit) base.published_home = Boolean(publishedHome);

    return base;
  }, [name, description, characteristics, isEdit, publishedHome]);

  const validate = () => {
    if (!payload.name) return "El nombre es obligatorio.";
    if (!payload.subtitle) return "La descripción es obligatoria.";
    if (!payload.bullets.length) return "Las características son obligatorias.";
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
            <div className="modal-title">{isEdit ? "Editar producto" : "Crear producto"}</div>
          </div>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="form">
          {err ? <div className="admin-alert">{String(err)}</div> : null}

          <label className="form-label">
            Nombre *
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Auto RC"
            />
          </label>

          <label className="form-label">
            Descripción *
            <textarea
              className="form-input"
              style={{ height: 90, paddingTop: 10, resize: "vertical" }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Responsabilidad Civil para autos"
            />
          </label>

          <label className="form-label">
            Características * (una por línea)
            <textarea
              className="form-input"
              style={{ height: 110, paddingTop: 10, resize: "vertical" }}
              value={characteristics}
              onChange={(e) => setCharacteristics(e.target.value)}
              placeholder={`Ej:\n- Asistencia 24hs\n- Granizo\n- Robo total`}
            />
          </label>

          {isEdit ? (
            <label className="form-label" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={publishedHome}
                onChange={(e) => setPublishedHome(e.target.checked)}
              />
              Visible en Home
            </label>
          ) : null}

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
