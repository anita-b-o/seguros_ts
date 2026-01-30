// src/components/receipts/ReceiptPreview.jsx
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

export default function ReceiptPreview({ policy, receipt }) {
  // Estos campos pueden venir del backend o los derivás:
  const clientNumber = receipt?.client_number || policy?.client_number || "-";
  const issuedAt = receipt?.issued_at || receipt?.created_at || receipt?.date;
  const amount = receipt?.amount ?? receipt?.total_amount ?? 0;
  const currency = receipt?.currency || "ARS";

  const insuredName =
    receipt?.insured_name ||
    policy?.insured_name ||
    policy?.holder_name ||
    "—";

  const vehicle =
    receipt?.vehicle_label ||
    policy?.vehicle_label ||
    policy?.vehicle ||
    policy?.vehicle_name ||
    "—";

  const plate = receipt?.plate || policy?.plate || "—";

  const policyNumber = receipt?.policy_number || policy?.number || "—";

  return (
    <div className="rcpt-paper">
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
            PRODUCTOR - ASESOR DE SEGUROS - DIAGONAL LOS POETAS 389 (BOSQUES) FCIO. VARELA
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
              <div className="rcpt-box" />
              <div className="rcpt-box" />
              <div className="rcpt-box" />
            </div>
          </div>
        </div>
      </div>

      <div className="rcpt-mid">
        <div className="rcpt-midLeft">
          <div className="rcpt-kv">
            <div className="rcpt-k">C.U.I.T.</div>
            <div className="rcpt-v">{receipt?.cuit || "—"}</div>
          </div>
          <div className="rcpt-kv">
            <div className="rcpt-k">Inicio de Actividades</div>
            <div className="rcpt-v">{receipt?.activity_start || "—"}</div>
          </div>
          <div className="rcpt-kv">
            <div className="rcpt-k">Email</div>
            <div className="rcpt-v">{receipt?.contact_email || "—"}</div>
          </div>
        </div>

        <div className="rcpt-midRight">
          <div className="rcpt-coverage">
            <div className="rcpt-coverageTitle">COBERTURA EN</div>
            <div className="rcpt-coverageBody">
              AUTOMOTORES - MOTOS - CASAS<br />
              ACCIDENTES PERSONALES - LOCALES - CARTELES
            </div>
            <div className="rcpt-coveragePay">EFECTIVO</div>
          </div>
        </div>
      </div>

      <div className="rcpt-dateRow">
        <div className="rcpt-dateLabel">FECHA</div>
        <div className="rcpt-dateValue">{fmtDate(issuedAt)}</div>
      </div>

      <div className="rcpt-received">
        <div className="rcpt-dots" />
        <div className="rcpt-receivedLine">Recibimos</div>
        <div className="rcpt-dots" />
        <div className="rcpt-receivedLine">La cantidad</div>
        <div className="rcpt-dots" />
      </div>

      <div className="rcpt-note">
        DICHO IMPORTE SE IMPUTARÁ AL PAGO DE LA PÓLIZA CORRESPONDIENTE / RECIBO POR CUENTA Y ORDEN DE TERCEROS
      </div>

      <div className="rcpt-table">
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Compañía</div>
          <div className="rcpt-cell">{receipt?.company_name || "—"}</div>
        </div>
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Asegurado</div>
          <div className="rcpt-cell">{insuredName}</div>
        </div>
        <div className="rcpt-row">
          <div className="rcpt-cell rcpt-cellLabel">Póliza</div>
          <div className="rcpt-cell">{policyNumber}</div>
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
          <div className="rcpt-cell rcpt-cellLabel">Total</div>
          <div className="rcpt-cell rcpt-amount">{fmtMoney(amount, currency)}</div>
        </div>
      </div>

      <div className="rcpt-stamp">
        <div className="rcpt-stampInner">PAGADO</div>
      </div>
    </div>
  );
}
