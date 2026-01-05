# backend/policies/serializers.py
import secrets
from datetime import date
from django.utils import timezone

from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from accounts.models import User
from payments.models import Payment
from products.models import Product
from vehicles.models import Vehicle
from .models import Policy, PolicyVehicle, PolicyInstallment
from .billing import (
    compute_installment_status,
    derive_policy_billing_status,
    ensure_policy_end_date,
    regenerate_installments,
)

VEHICLE_OWNER_MISMATCH_ERROR = "El vehículo no pertenece al titular de la póliza."


class PolicyVehicleSerializer(serializers.ModelSerializer):
    def to_internal_value(self, data):
        # Normalizamos strings vacíos a None para evitar errores de validación
        if isinstance(data, dict):
            data = {k: (v if v != "" else None) for k, v in data.items()}
        return super().to_internal_value(data)

    class Meta:
        model = PolicyVehicle
        fields = [
            "plate",
            "make",
            "model",
            "version",
            "year",
            "city",
            "has_garage",
            "is_zero_km",
            "usage",
            "has_gnc",
            "gnc_amount",
        ]
        extra_kwargs = {
            "plate": {"required": False, "allow_blank": True, "allow_null": True},
            "make": {"required": False, "allow_blank": True, "allow_null": True},
            "model": {"required": False, "allow_blank": True, "allow_null": True},
            "version": {"required": False, "allow_blank": True, "allow_null": True},
            "year": {"required": False, "allow_null": True},
            "city": {"required": False, "allow_blank": True, "allow_null": True},
            "usage": {"required": False, "allow_blank": True, "allow_null": True},
        }


class UserMinimalSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name"]


class PolicyInstallmentSerializer(serializers.ModelSerializer):
    effective_status = serializers.SerializerMethodField()
    payment = serializers.SerializerMethodField()

    class Meta:
        model = PolicyInstallment
        fields = [
            "id",
            "sequence",
            "period_start_date",
            "period_end_date",
            "payment_window_start",
            "payment_window_end",
            "due_date_display",
            "due_date_real",
            "amount",
            "status",
            "effective_status",
            "paid_at",
            "payment",
        ]

    def get_effective_status(self, obj):
        return compute_installment_status(obj)

    def get_payment(self, obj):
        if hasattr(obj, "_payment_id"):
            return getattr(obj, "_payment_id")
        payment = (
            Payment.objects.filter(installment=obj)
            .only("id")
            .order_by("-id")
            .first()
        )
        return payment.id if payment else None


class PolicySerializer(serializers.ModelSerializer):
    vehicle = PolicyVehicleSerializer(required=False, write_only=True)
    vehicle_id = serializers.PrimaryKeyRelatedField(
        queryset=Vehicle.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    installments = serializers.SerializerMethodField()
    user = UserMinimalSerializer(read_only=True)
    user_id = serializers.PrimaryKeyRelatedField(
        source="user",
        queryset=User.objects.all(),
        required=False,
        allow_null=True,
    )
    product = serializers.PrimaryKeyRelatedField(read_only=True)
    product_id = serializers.PrimaryKeyRelatedField(
        source="product",
        queryset=Product.objects.all(),
        allow_null=True,
        required=False,
    )
    product_name = serializers.SerializerMethodField()
    client_end_date = serializers.SerializerMethodField()
    payment_start_date = serializers.SerializerMethodField()
    payment_end_date = serializers.SerializerMethodField()
    adjustment_from = serializers.SerializerMethodField()
    adjustment_to = serializers.SerializerMethodField()
    real_end_date = serializers.SerializerMethodField()
    has_pending_charge = serializers.SerializerMethodField()
    has_paid_in_window = serializers.SerializerMethodField()
    billing_status = serializers.SerializerMethodField()

    class Meta:
        model = Policy
        fields = [
            "id",
            "number",
            "user",
            "user_id",
            "product",
            "product_id",
            "product_name",
            "premium",
            "status",
            "start_date",
            "end_date",
            "client_end_date",
            "real_end_date",
            "payment_start_date",
            "payment_end_date",
            "adjustment_from",
            "adjustment_to",
            "has_pending_charge",
            "has_paid_in_window",
            "claim_code",
            "billing_status",
            "installments",
            "vehicle",
            "vehicle_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {
            "number": {"required": False, "allow_null": True, "allow_blank": True},
        }

    def get_product_name(self, obj):
        return getattr(obj.product, "name", None)

    def get_client_end_date(self, obj):
        return self._timeline_value(obj, "client_end_date")

    def get_payment_start_date(self, obj):
        return self._timeline_value(obj, "payment_start_date")

    def get_payment_end_date(self, obj):
        return self._timeline_value(obj, "payment_end_date")

    def get_adjustment_from(self, obj):
        return self._timeline_value(obj, "adjustment_from")

    def get_adjustment_to(self, obj):
        return self._timeline_value(obj, "adjustment_to")

    def get_real_end_date(self, obj):
        return self._timeline_value(obj, "real_end_date") or getattr(obj, "end_date", None)

    def get_has_pending_charge(self, obj):
        try:
            # Charge is gone; we rely solely on installments to detect pending amounts.
            return obj.installments.exclude(status=PolicyInstallment.Status.PAID).exists()
        except Exception:
            return False

    def get_has_paid_in_window(self, obj):
        try:
            timeline = self.context.get("timeline_map", {}).get(obj.id, {})
            start = timeline.get("payment_start_date")
            end = timeline.get("payment_end_date")
            if not start or not end:
                return False
            start_d = date.fromisoformat(start) if isinstance(start, str) else start
            end_d = date.fromisoformat(end) if isinstance(end, str) else end
            # Reflect paid history via installments because no Charge model exists anymore.
            return obj.installments.filter(
                status=PolicyInstallment.Status.PAID,
                paid_at__date__gte=start_d,
                paid_at__date__lte=end_d,
            ).exists()
        except Exception:
            return False

    def get_billing_status(self, obj):
        installments_mgr = getattr(obj, "installments", [])
        installments = list(installments_mgr.all()) if hasattr(installments_mgr, "all") else list(installments_mgr)
        statuses = []
        for inst in installments:
            inst.status = compute_installment_status(inst)
            statuses.append(inst)
        return derive_policy_billing_status(statuses)

    def get_installments(self, obj):
        installments_mgr = getattr(obj, "installments", [])
        installments = list(installments_mgr.all()) if hasattr(installments_mgr, "all") else list(installments_mgr)
        # Actualizamos en memoria para reflejar el estado correcto en la API
        for inst in installments:
            inst.status = compute_installment_status(inst)
            inst._payment_id = None
        installment_ids = [inst.id for inst in installments if inst.id]
        if installment_ids:
            payments = Payment.objects.filter(installment_id__in=installment_ids)
            payment_by_installment = {p.installment_id: p.id for p in payments}
            for inst in installments:
                inst._payment_id = payment_by_installment.get(inst.id)
        return PolicyInstallmentSerializer(installments, many=True).data

    def _timeline_value(self, obj, key):
        return self.context.get("timeline_map", {}).get(obj.id, {}).get(key)

    def validate(self, attrs):
        """
        Requerimos datos mínimos para poder facturar y generar cargos.
        """
        data = super().validate(attrs)
        instance = getattr(self, "instance", None)

        product = data.get("product") or getattr(instance, "product", None)
        if not product:
            raise ValidationError({"product_id": "Seleccioná un producto."})

        premium = data.get("premium", getattr(instance, "premium", None))
        if premium is None:
            raise ValidationError({"premium": "Indicá el premio mensual (premium)."})

        start_date = data.get("start_date", getattr(instance, "start_date", None))
        if not start_date:
            raise ValidationError({"start_date": "Definí la fecha de inicio de vigencia."})

        self._validate_vehicle_owner_payload(data)
        return data

    def create(self, validated_data):
        validated_data = self._ensure_number(validated_data)
        validated_data = self._ensure_claim_code(validated_data)
        vehicle_payload = validated_data.pop("vehicle", None)
        vehicle_ref = validated_data.pop("vehicle_id", None)
        vehicle_data = self._clean_vehicle_data(vehicle_payload)
        policy = super().create(validated_data)
        self._assign_vehicle(policy, vehicle_ref, vehicle_data)
        ensure_policy_end_date(policy)
        regenerate_installments(policy)
        return policy

    def update(self, instance, validated_data):
        validated_data = self._ensure_number(validated_data, allow_keep=True, instance=instance)
        validated_data = self._ensure_claim_code(validated_data, instance=instance)
        vehicle_payload = validated_data.pop("vehicle", None)
        vehicle_ref = validated_data.pop("vehicle_id", None)
        vehicle_data = self._clean_vehicle_data(vehicle_payload)
        policy = super().update(instance, validated_data)
        # Si cambia vigencia o precio mensual regeneramos cuotas
        ensure_policy_end_date(policy)
        regenerate_installments(policy)
        self._assign_vehicle(policy, vehicle_ref, vehicle_data)
        return policy

    def _clean_vehicle_data(self, vehicle_data):
        """
        Evita errores cuando el front envía strings vacíos; si no hay datos
        significativos, devolvemos None para omitir la actualización/creación.
        """
        if not vehicle_data:
            return None
        cleaned = {}
        for key, value in vehicle_data.items():
            if isinstance(value, str):
                value = value.strip()
            if value in ("", None):
                continue
            if key == "year":
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    continue
            cleaned[key] = value
        if not cleaned:
            return None
        # Si se cargan datos de vehículo, año es obligatorio para evitar IntegrityError.
        if "year" not in cleaned:
            raise ValidationError({"vehicle": "El año del vehículo es obligatorio si cargás datos de vehículo."})
        return cleaned

    def _assign_vehicle(self, policy, vehicle_ref, vehicle_data):
        if vehicle_ref is not None:
            self._validate_vehicle_owner(policy, vehicle_ref)
            if policy.vehicle_id != vehicle_ref.id:
                policy.vehicle = vehicle_ref
                policy.save(update_fields=["vehicle"])
            return
        if vehicle_data:
            vehicle = self._resolve_or_create_vehicle(policy, vehicle_data)
            if vehicle and policy.vehicle_id != vehicle.id:
                policy.vehicle = vehicle
                policy.save(update_fields=["vehicle"])

    def _validate_vehicle_owner_payload(self, data):
        vehicle = self._get_candidate_vehicle(data)
        if not vehicle:
            return
        user = self._get_candidate_user(data)
        if not user:
            return
        if vehicle.owner_id != user.id:
            raise ValidationError({"vehicle": VEHICLE_OWNER_MISMATCH_ERROR})

    def _validate_vehicle_owner(self, policy, vehicle):
        user_id = policy.user_id
        if not user_id:
            user_id = self._request_user_id()
        if not user_id:
            return
        if vehicle.owner_id != user_id:
            raise ValidationError({"vehicle": VEHICLE_OWNER_MISMATCH_ERROR})

    def _get_candidate_vehicle(self, data):
        candidate = data.get("vehicle_id") or data.get("vehicle")
        if isinstance(candidate, Vehicle):
            return candidate
        return getattr(self.instance, "vehicle", None)

    def _get_candidate_user(self, data):
        user = data.get("user") or getattr(self.instance, "user", None)
        if user:
            return user
        return self._request_user()

    def _request_user(self):
        request = self.context.get("request")
        if request and getattr(request, "user", None) and request.user.is_authenticated:
            return request.user
        return None

    def _request_user_id(self):
        user = self._request_user()
        return user.id if user else None

    def _resolve_or_create_vehicle(self, policy, vehicle_data):
        if not policy.user_id:
            return None
        plate = vehicle_data.get("plate")
        if not plate:
            return None
        plate_norm = plate.strip().upper()
        vehicle, created = Vehicle.objects.get_or_create(
            owner_id=policy.user_id,
            license_plate=plate_norm,
            defaults={
                "vtype": "AUTO",
                "brand": vehicle_data.get("make") or "Desconocida",
                "model": vehicle_data.get("model") or "Sin modelo",
                "year": vehicle_data.get("year") or timezone.now().year,
                "use": vehicle_data.get("usage") or "Particular",
            },
        )
        return vehicle

    def _normalize_number(self, raw_value):
        """
        Normaliza y valida que el número comience con el prefijo obligatorio.
        """
        if raw_value is None:
            raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})
        value = str(raw_value).strip()
        if not value:
            raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})
        if value[:3].upper() != "SC-":
            raise ValidationError({"number": "El número de póliza debe comenzar con 'SC-'."})
        return "SC-" + value[3:]

    def _ensure_number(self, validated_data, allow_keep=False, instance=None):
        """
        - Si viene number con contenido válido, lo normaliza.
        - En update, si allow_keep=True y no viene number, conserva el actual.
        - En creación, exige que el admin provea el número.
        """
        number = validated_data.get("number", None)
        if number not in (None, ""):
            validated_data["number"] = self._normalize_number(number)
            return validated_data
        if allow_keep and instance is not None and instance.number:
            validated_data.pop("number", None)
            return validated_data
        raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})

    def _ensure_claim_code(self, validated_data, instance=None):
        """
        Genera claim_code si no existe para evitar pólizas sin código de asociación.
        """
        code = validated_data.get("claim_code", None)
        if code:
            return validated_data
        current = getattr(instance, "claim_code", None)
        if current:
            validated_data.pop("claim_code", None)
            return validated_data
        validated_data["claim_code"] = self._generate_claim_code()
        return validated_data

    def _generate_claim_code(self):
        for _ in range(5):
            candidate = f"SC-{secrets.token_hex(3).upper()}"
            if not Policy.objects.filter(claim_code__iexact=candidate).exists():
                return candidate
        return f"SC-{secrets.token_hex(4).upper()}"

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["vehicle"] = self._represent_vehicle(instance.vehicle)
        return data

    def _represent_vehicle(self, vehicle):
        if not vehicle:
            return None
        return {
            "plate": vehicle.license_plate,
            "make": vehicle.brand,
            "model": vehicle.model,
            "version": "",
            "year": vehicle.year,
            "city": "",
            "has_garage": False,
            "is_zero_km": False,
            "usage": vehicle.use,
            "has_gnc": False,
            "gnc_amount": None,
        }


class PolicyClientListSerializer(serializers.ModelSerializer):
    product = serializers.SerializerMethodField()
    plate = serializers.SerializerMethodField()
    client_end_date = serializers.SerializerMethodField()
    real_end_date = serializers.SerializerMethodField()
    payment_start_date = serializers.SerializerMethodField()
    payment_end_date = serializers.SerializerMethodField()
    adjustment_from = serializers.SerializerMethodField()
    adjustment_to = serializers.SerializerMethodField()

    class Meta:
        model = Policy
        fields = [
            "id",
            "number",
            "product",
            "plate",
            "premium",
            "status",
            "start_date",
            "end_date",
            "client_end_date",
            "real_end_date",
            "payment_start_date",
            "payment_end_date",
            "adjustment_from",
            "adjustment_to",
        ]

    def get_client_end_date(self, obj):
        return self._timeline_value(obj, "client_end_date") or obj.end_date

    def get_payment_start_date(self, obj):
        return self._timeline_value(obj, "payment_start_date")

    def get_payment_end_date(self, obj):
        return self._timeline_value(obj, "payment_end_date")

    def get_adjustment_from(self, obj):
        return self._timeline_value(obj, "adjustment_from")

    def get_adjustment_to(self, obj):
        return self._timeline_value(obj, "adjustment_to")

    def get_real_end_date(self, obj):
        return self._timeline_value(obj, "real_end_date") or getattr(obj, "end_date", None)

    def get_product(self, obj):
        return getattr(obj.product, "name", None)

    def get_plate(self, obj):
        return getattr(getattr(obj, "vehicle", None), "plate", None)

    def _timeline_value(self, obj, key):
        return self.context.get("timeline_map", {}).get(obj.id, {}).get(key)


class PolicyClientDetailSerializer(serializers.ModelSerializer):
    product = serializers.SerializerMethodField()
    plate = serializers.SerializerMethodField()
    vehicle = serializers.SerializerMethodField()
    real_status = serializers.CharField(source="status")
    client_end_date = serializers.SerializerMethodField()
    real_end_date = serializers.SerializerMethodField()
    payment_start_date = serializers.SerializerMethodField()
    payment_end_date = serializers.SerializerMethodField()
    adjustment_from = serializers.SerializerMethodField()
    adjustment_to = serializers.SerializerMethodField()

    class Meta:
        model = Policy
        fields = [
            "id",
            "number",
            "status",
            "real_status",
            "premium",
            "start_date",
            "end_date",
            "client_end_date",
            "real_end_date",
            "payment_start_date",
            "payment_end_date",
            "adjustment_from",
            "adjustment_to",
            "product",
            "plate",
            "vehicle",
            "city",
            "has_garage",
            "is_zero_km",
            "usage",
            "has_gnc",
            "gnc_amount",
            "claim_code",
            "user",
        ]

    city = serializers.SerializerMethodField()
    has_garage = serializers.SerializerMethodField()
    is_zero_km = serializers.SerializerMethodField()
    usage = serializers.SerializerMethodField()
    has_gnc = serializers.SerializerMethodField()
    gnc_amount = serializers.SerializerMethodField()

    def get_client_end_date(self, obj):
        return self._timeline_value(obj, "client_end_date") or obj.end_date

    def get_payment_start_date(self, obj):
        return self._timeline_value(obj, "payment_start_date")

    def get_payment_end_date(self, obj):
        return self._timeline_value(obj, "payment_end_date")

    def get_adjustment_from(self, obj):
        return self._timeline_value(obj, "adjustment_from")

    def get_adjustment_to(self, obj):
        return self._timeline_value(obj, "adjustment_to")

    def get_real_end_date(self, obj):
        return self._timeline_value(obj, "real_end_date") or getattr(obj, "end_date", None)

    def _get_vehicle(self, obj):
        try:
            return obj.vehicle
        except Exception:
            return None

    def get_product(self, obj):
        return getattr(obj.product, "name", None)

    def get_plate(self, obj):
        vehicle = self._get_vehicle(obj)
        return getattr(vehicle, "plate", None)

    def get_vehicle(self, obj):
        vehicle = self._get_vehicle(obj)
        return PolicyVehicleSerializer(vehicle).data if vehicle else None

    def get_city(self, obj):
        vehicle = self._get_vehicle(obj)
        return getattr(vehicle, "city", None)

    def get_has_garage(self, obj):
        vehicle = self._get_vehicle(obj)
        return getattr(vehicle, "has_garage", None)

    def get_is_zero_km(self, obj):
        vehicle = self._get_vehicle(obj)
        return getattr(vehicle, "is_zero_km", None)

    def get_usage(self, obj):
        vehicle = self._get_vehicle(obj)
        return getattr(vehicle, "usage", None)

    def get_has_gnc(self, obj):
        vehicle = self._get_vehicle(obj)
        return getattr(vehicle, "has_gnc", None)

    def get_gnc_amount(self, obj):
        vehicle = self._get_vehicle(obj)
        return getattr(vehicle, "gnc_amount", None)

    def _timeline_value(self, obj, key):
        return self.context.get("timeline_map", {}).get(obj.id, {}).get(key)
