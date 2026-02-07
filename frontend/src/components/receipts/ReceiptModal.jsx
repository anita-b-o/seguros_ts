// src/components/receipts/ReceiptModal.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { closeReceiptModal, downloadReceiptPdfThunk } from "@/features/receipts/receiptsSlice";
import ReceiptPreview from "./ReceiptPreview";

function downloadBlob(blob, filename) {
  if (!(blob instanceof Blob)) return;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function collectCssText() {
  let css = "";
  const sheets = Array.from(document.styleSheets || []);
  for (const sheet of sheets) {
    try {
      const rules = sheet.cssRules || [];
      for (const rule of rules) {
        css += `${rule.cssText}\n`;
      }
    } catch {
      // Ignorar hojas con CORS/permiso denegado.
    }
  }
  return css;
}

async function nodeToPngBlob(node, { scale = 2 } = {}) {
  if (!node) throw new Error("Nodo de comprobante no disponible.");
  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));

  const cssText = collectCssText();
  const wrapper = document.createElement("div");
  const clone = node.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.appendChild(clone);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">
          <style>${cssText}</style>
          ${wrapper.innerHTML}
        </div>
      </foreignObject>
    </svg>
  `;

  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const img = new Image();
  const imageLoaded = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo renderizar la imagen."));
  });
  img.src = svgUrl;
  await imageLoaded;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el canvas.");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo generar la imagen."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function pickFirst(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

export default function ReceiptModal() {
  const dispatch = useDispatch();

  const { receiptModalOpen, selectedReceipt, downloadByReceiptId } = useSelector((s) => s.receipts);
  const previewRef = useRef(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");

  const isOpen = Boolean(receiptModalOpen && selectedReceipt?.policy && selectedReceipt?.receipt);

  const policy = selectedReceipt?.policy || null;
  const receipt = selectedReceipt?.receipt || null;

  const receiptId = receipt?.id ?? null;
  const downloadState = receiptId != null ? downloadByReceiptId?.[receiptId] : null;

  const downloading = Boolean(downloadState?.loading);

  const policyNumber = useMemo(() => {
    return (
      pickFirst(policy, ["number", "policy_number", "policyNumber", "code"]) ||
      (policy?.id != null ? String(policy.id) : "-")
    );
  }, [policy]);

  const close = () => dispatch(closeReceiptModal());

  // UX: cerrar con ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDownload = async () => {
    if (!policy?.id || receiptId == null || downloading) return;

    const res = await dispatch(
      downloadReceiptPdfThunk({
        policyId: policy.id,
        receiptId,
      })
    );

    if (downloadReceiptPdfThunk.fulfilled.match(res)) {
      const blob = res.payload?.blob;
      if (!blob) return;

      const filename = `comprobante_${policyNumber}_${receiptId}.pdf`;
      downloadBlob(blob, filename);
    }
  };

  const onDownloadImage = async () => {
    if (!receiptId || imageBusy) return;
    setImageError("");
    setImageBusy(true);
    try {
      const blob = await nodeToPngBlob(previewRef.current, { scale: 2 });
      const filename = `comprobante_${policyNumber}_${receiptId}.png`;
      downloadBlob(blob, filename);
    } catch (e) {
      setImageError(e?.message || "No se pudo generar la imagen.");
    } finally {
      setImageBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="rcpt-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de comprobante"
      onMouseDown={(e) => {
        // Cierra si hacen click en el backdrop (no dentro del modal)
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="rcpt-modal" role="document">
        {/* Header */}
        <div className="rcpt-modal-head">
          <div>
            <div className="rcpt-modal-title">Comprobante</div>
            <div className="rcpt-modal-sub">
              Póliza: <strong>{policyNumber}</strong>
            </div>
          </div>

          <button className="rcpt-btn rcpt-btn-ghost" onClick={close} type="button">
            Cerrar
          </button>
        </div>

        {/* Body */}
        <div className="rcpt-modal-body">
          <ReceiptPreview policy={policy} receipt={receipt} ref={previewRef} />
        </div>

        {/* Footer */}
        <div className="rcpt-modal-foot">
          <button className="rcpt-btn" onClick={onDownload} disabled={downloading} type="button">
            {downloading ? "Descargando…" : "Descargar PDF"}
          </button>
          <button className="rcpt-btn rcpt-btn-ghost" onClick={onDownloadImage} disabled={imageBusy} type="button">
            {imageBusy ? "Generando…" : "Descargar imagen"}
          </button>

          {downloadState?.error ? (
            <div className="rcpt-alert">{String(downloadState.error)}</div>
          ) : null}
          {imageError ? <div className="rcpt-alert">{String(imageError)}</div> : null}
        </div>
      </div>
    </div>
  );
}
