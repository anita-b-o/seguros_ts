// src/components/receipts/ReceiptModal.jsx
import { useEffect, useMemo } from "react";
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
          <ReceiptPreview policy={policy} receipt={receipt} />
        </div>

        {/* Footer */}
        <div className="rcpt-modal-foot">
          <button className="rcpt-btn" onClick={onDownload} disabled={downloading} type="button">
            {downloading ? "Descargando…" : "Descargar PDF"}
          </button>

          {downloadState?.error ? (
            <div className="rcpt-alert">{String(downloadState.error)}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
