from django.core.exceptions import ValidationError
from policies.models import PolicyVehicle


def _normalize_plate(plate):
    if not plate:
        return None
    return str(plate).strip().upper()


def _snapshot_payload_from_vehicle(vehicle):
    if not vehicle:
        return {}
    return {
        "plate": vehicle.license_plate,
        "make": vehicle.brand,
        "model": vehicle.model,
        "year": vehicle.year,
        "usage": vehicle.use,
    }


def _merge_snapshot_payload(payload=None, source_vehicle=None):
    data = {}
    data.update(_snapshot_payload_from_vehicle(source_vehicle))
    if payload:
        data.update({k: v for k, v in payload.items() if v not in ("", None)})
    if "plate" in data:
        data["plate"] = _normalize_plate(data["plate"])
    return data


def _can_overwrite_snapshot(policy, *, overwrite):
    if not overwrite:
        return False
    return True


def ensure_policy_vehicle_snapshot(policy, *, source_vehicle=None, payload=None, overwrite=False):
    """
    Asegura el snapshot contractual (PolicyVehicle) para una póliza.
    No sobreescribe snapshots existentes salvo overwrite=True.
    """
    if policy is None:
        raise ValidationError({"vehicle": "Falta la póliza para generar el vehículo contractual."})

    existing = getattr(policy, "legacy_vehicle", None)
    if existing and not _can_overwrite_snapshot(policy, overwrite=overwrite):
        return existing

    data = _merge_snapshot_payload(payload=payload, source_vehicle=source_vehicle)
    required = ["plate", "make", "model", "year"]
    missing = [field for field in required if not data.get(field)]
    if missing:
        raise ValidationError(
            {"vehicle": "Datos insuficientes para crear el vehículo de póliza."}
        )

    data.setdefault("version", "")
    data.setdefault("city", "")
    data.setdefault("usage", data.get("usage") or "privado")
    data.setdefault("has_garage", False)
    data.setdefault("is_zero_km", False)
    data.setdefault("has_gnc", False)
    data.setdefault("gnc_amount", None)

    if existing:
        for key, value in data.items():
            setattr(existing, key, value)
        existing.save()
        return existing

    return PolicyVehicle.objects.create(policy=policy, **data)
