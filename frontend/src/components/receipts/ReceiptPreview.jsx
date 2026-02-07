// src/components/receipts/ReceiptPreview.jsx
import { forwardRef } from "react";
function fmtMoney(amount, currency = "ARS") {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("es-AR");
}

function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addMonthsClamped(date, months) {
  const d = parseLocalDate(date);
  if (!d || Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function monthDiffInclusive(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const s = parseLocalDate(startISO);
  const e = parseLocalDate(endISO);
  if (!s || !e || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
}

function monthIndexFromStart(startISO, refISO) {
  if (!startISO || !refISO) return null;
  const s = parseLocalDate(startISO);
  const r = parseLocalDate(refISO);
  if (!s || !r || Number.isNaN(s.getTime()) || Number.isNaN(r.getTime())) return null;
  return (r.getFullYear() - s.getFullYear()) * 12 + (r.getMonth() - s.getMonth()) + 1;
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function userFullName(u) {
  if (!u) return "";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.full_name || u.name || "";
}

function dateParts(iso) {
  if (!iso) return { day: "--", month: "--", year: "----" };
  const d = parseLocalDate(iso);
  if (!d || Number.isNaN(d.getTime())) return { day: "--", month: "--", year: "----" };
  const pad = (n) => String(n).padStart(2, "0");
  return {
    day: pad(d.getDate()),
    month: pad(d.getMonth() + 1),
    year: String(d.getFullYear()),
  };
}

const ReceiptPreview = forwardRef(function ReceiptPreview({ policy, receipt }, ref) {
  // Estos campos pueden venir del backend o los derivás:
  const clientNumber = receipt?.client_number || policy?.client_number || "-";
  const issuedAtRaw = receipt?.date || receipt?.created_at || null;
  const issuedAt = issuedAtRaw ? parseLocalDate(issuedAtRaw) : null;
  const receiptAmount = receipt?.amount ?? receipt?.total_amount ?? null;
  const policyAmount =
    pickFirst(policy, ["premium", "amount", "total", "total_amount"]) ?? null;
  const amount = receiptAmount ?? policyAmount ?? 0;
  const currency =
    pickFirst(receipt, ["currency", "moneda"]) ||
    pickFirst(policy, ["currency"]) ||
    "ARS";
  const currencyLabel =
    String(currency || "").toUpperCase() === "ARS" ||
    String(currency || "").toUpperCase() === "PESOS"
      ? "Pesos"
      : String(currency || "");
  const receiptNextDue = receipt?.next_due || null;
  const currentDue =
    pickFirst(receipt, [
      "due_date_soft",
      "next_due_date",
      "due_date",
      "payment_due",
      "due_date_hard",
    ]) ||
    pickFirst(policy, ["client_end_date", "payment_end_date", "real_end_date"]);
  const nextDue = receiptNextDue || (currentDue ? addMonthsClamped(currentDue, 1) : null);
  const dueParts = dateParts(nextDue);

  const insuredName =
    receipt?.insured_name ||
    policy?.insured_name ||
    policy?.holder_name ||
    "—";

  const companyName =
    "P R O F";

  const vehicleObj =
    policy?.vehicle ||
    policy?.policy_vehicle ||
    policy?.policyVehicle ||
    receipt?.vehicle ||
    null;
  const vehicleBrand =
    pickFirst(vehicleObj, ["brand", "make", "marca"]) ||
    pickFirst(receipt, ["vehicle_brand", "vehicle_make", "make"]);
  const vehicleModel =
    pickFirst(vehicleObj, ["model", "modelo"]) ||
    pickFirst(receipt, ["vehicle_model", "model"]);
  const vehicleVersion =
    pickFirst(vehicleObj, ["version", "trim"]) ||
    pickFirst(receipt, ["vehicle_version", "version"]);
  const vehicleFallback =
    receipt?.vehicle_label ||
    policy?.vehicle_label ||
    policy?.vehicle_name ||
    "";
  const vehicle =
    [vehicleBrand, vehicleModel, vehicleVersion].filter(Boolean).join(" ") ||
    vehicleFallback ||
    "—";

  const plate =
    receipt?.plate ||
    policy?.plate ||
    vehicleObj?.plate ||
    vehicleObj?.patente ||
    "—";

  const policyNumber = receipt?.policy_number || policy?.number || "—";
  const policyUser = policy?.user || policy?.user_obj || policy?.client || null;
  const receivedFrom =
    userFullName(policyUser) ||
    receipt?.client_name ||
    receipt?.payer_name ||
    receipt?.insured_name ||
    policy?.insured_name ||
    policy?.holder_name ||
    insuredName ||
    "—";
  const startDate = pickFirst(policy, ["start_date", "startDate", "term_start"]);
  const endDate = pickFirst(policy, ["end_date", "endDate", "term_end"]);
  const totalPeriods = monthDiffInclusive(startDate, endDate) || null;
  const currentIndex = monthIndexFromStart(startDate, issuedAtRaw || issuedAt) || null;
  let installment = "—";
  const receiptInstallment =
    receipt?.installment ||
    receipt?.installment_number ||
    receipt?.installment_no ||
    receipt?.period_code ||
    null;
  if (receiptInstallment && String(receiptInstallment).includes("/")) {
    installment = String(receiptInstallment);
  } else if (totalPeriods && currentIndex) {
    const safeIndex = Math.min(Math.max(currentIndex, 1), totalPeriods);
    installment = `${safeIndex}/${totalPeriods}`;
  }
  const receiptStatus = String(
    receipt?.status ||
      receipt?.state ||
      receipt?.payment_status ||
      receipt?.billing_status ||
      ""
  ).toUpperCase();
  const isReceiptPaid =
    receipt?.is_paid === true ||
    receipt?.paid === true ||
    ["APPROVED", "PAID", "PAGADO", "APR"].includes(receiptStatus);

  return (
    <div className="rcpt-paper" ref={ref}>
      <div className="rcpt-top">
        <div className="rcpt-brand">
          <div className="rcpt-logoBox">
            <div className="rcpt-logoMark">SC</div>
            <div className="rcpt-brandText">
              <div className="rcpt-brandName">San Cayetano</div>
            <div className="rcpt-brandSub">Seguros Generales</div>
          </div>
        </div>

          <div className="rcpt-line">
            <span className="rcpt-lineLeft">
              PRODUCTOR - ASESOR DE SEGUROS - DIAGONAL LOS POETAS 389 (BOSQUES) FCIO. VARELA
            </span>
            <span className="rcpt-lineRight">11-6033-0747</span>
          </div>
        </div>

        <div className="rcpt-meta">
          <div className="rcpt-metaRow">
            <div className="rcpt-metaLabel">CLIENTE N°</div>
            <div className="rcpt-metaValue">{clientNumber}</div>
          </div>

          <div className="rcpt-metaRow">
            <div className="rcpt-metaLabel">PRÓXIMO VENCIMIENTO</div>
            <div className="rcpt-boxes">
              <div className="rcpt-box">{dueParts.day}</div>
              <div className="rcpt-box">{dueParts.month}</div>
              <div className="rcpt-box">{dueParts.year}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rcpt-mid">
        <div className="rcpt-midLeft">
          <div className="rcpt-kv">
            <div className="rcpt-k">C.U.I.T.</div>
            <div className="rcpt-v">27-21672285-5</div>
          </div>
          <div className="rcpt-kv">
            <div className="rcpt-k">Ing. Btos.</div>
            <div className="rcpt-v">27-21672285-5</div>
          </div>
          <div className="rcpt-kv">
            <div className="rcpt-k">Inicio de Actividades</div>
            <div className="rcpt-v">26/04/99</div>
          </div>
          <div className="rcpt-kv">
            <div className="rcpt-k">Email</div>
            <div className="rcpt-v">antoniosancayetano@hotmail.com</div>
          </div>
        </div>

        <div className="rcpt-midRight">
          <div className="rcpt-coverage">
            <div className="rcpt-coverageTitle">COBERTURA EN</div>
            <div className="rcpt-coverageBody">
              AUTOMOTORES - MOTOS - CASAS<br />
              ACCIDENTES PERSONALES - LOCALES - CARTELES
            </div>
          </div>
        </div>
      </div>

      <div className="rcpt-dateRow">
        <div className="rcpt-dateLabel">FECHA</div>
        <div className="rcpt-dateValue">
          <span className="rcpt-dateFill">{fmtDate(issuedAt)}</span>
        </div>
      </div>

      <div className="rcpt-received">
        <div className="rcpt-receivedRow">
          <span className="rcpt-receivedLabel">Recibimos</span>
          <span className="rcpt-receivedValue">{receivedFrom}</span>
          <span className="rcpt-dots" />
        </div>
        <div className="rcpt-receivedRow">
          <span className="rcpt-receivedLabel">La cantidad</span>
          <span className="rcpt-receivedValue">{fmtMoney(amount, currency)}</span>
          <span className="rcpt-dots" />
        </div>
      </div>

      <div className="rcpt-note">
        DICHO IMPORTE SE IMPUTARÁ AL PAGO DE LA PÓLIZA CORRESPONDIENTE / RECIBO POR CUENTA Y ORDEN DE TERCEROS
      </div>

      <div className="rcpt-table">
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Compañía</div>
          <div className="rcpt-cell">{companyName}</div>
        </div>
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Vehículo</div>
          <div className="rcpt-cell">{vehicle}</div>
        </div>
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Patente</div>
          <div className="rcpt-cell">{plate}</div>
        </div>
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Póliza</div>
          <div className="rcpt-cell">{policyNumber}</div>
        </div>
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Cuota</div>
          <div className="rcpt-cell">{installment}</div>
        </div>
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Tipo de moneda</div>
          <div className="rcpt-cell">{currencyLabel || "—"}</div>
        </div>
        <div className="rcpt-row rcpt-rowTotal">
          <div className="rcpt-cell rcpt-cellLabel">Total</div>
          <div className="rcpt-cell rcpt-amount">{fmtMoney(amount, currency)}</div>
        </div>
      </div>

      {isReceiptPaid ? (
        <div className="rcpt-stamp">
          <div className="rcpt-stampInner">PAGADO</div>
        </div>
      ) : null}
    </div>
  );
});

export default ReceiptPreview;
