// src/components/receipts/PolicyCardHeader.jsx
function pickFirst(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function getProductName(p) {
  const product = p?.product || p?.insurance_type || p?.plan || null;
  return (
    pickFirst(product, ["name", "plan_name", "title"]) ||
    pickFirst(p, ["product_name", "plan_name"]) ||
    ""
  );
}

function getVehicleLabel(p) {
  const vehicle =
    p?.vehicle || p?.policy_vehicle || p?.policyVehicle || p?.contract_vehicle || null;
  const label =
    pickFirst(vehicle, ["label", "display", "name"]) ||
    [pickFirst(vehicle, ["make", "brand"]), pickFirst(vehicle, ["model"]), pickFirst(vehicle, ["year"])]
      .filter(Boolean)
      .join(" ");
  return label || "";
}

function getPlate(p) {
  const vehicle =
    p?.vehicle || p?.policy_vehicle || p?.policyVehicle || p?.contract_vehicle || null;
  return pickFirst(vehicle, ["plate", "license_plate", "patent"]) || pickFirst(p, ["plate"]) || "";
}

export default function PolicyCardHeader({ policy }) {
  const policyNumber = pickFirst(policy, ["number", "policy_number", "policyNumber"]) || "-";
  const productName = getProductName(policy) || "—";
  const vehicleLabel = getVehicleLabel(policy) || "—";
  const plate = getPlate(policy);

  return (
    <div className="rcpt-policyTitle">
      <div className="rcpt-policyNumber">
        Póliza <strong>{policyNumber}</strong>
      </div>
      <div className="rcpt-policySub">
        {productName} · {vehicleLabel} {plate ? `· ${plate}` : ""}
      </div>
    </div>
  );
}
