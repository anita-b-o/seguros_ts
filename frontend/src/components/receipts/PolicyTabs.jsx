// src/components/receipts/PolicyTabs.jsx
export default function PolicyTabs({ tab, onChange }) {
  return (
    <div className="rcpt-tabs">
      <button
        className={`rcpt-tab ${tab === "receipts" ? "is-active" : ""}`}
        onClick={() => onChange("receipts")}
        type="button"
      >
        Comprobantes
      </button>
      <button
        className={`rcpt-tab ${tab === "pending" ? "is-active" : ""}`}
        onClick={() => onChange("pending")}
        type="button"
      >
        Período vigente
      </button>
    </div>
  );
}
