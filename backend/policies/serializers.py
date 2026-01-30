# backend/policies/serializers.py
import secrets
from datetime import date, timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, ValidationError

from accounts.models import User
from payments.billing import ensure_current_billing_period, get_current_billing_period
from payments.models import BillingPeriod, Payment
from products.models import Product
from vehicles.models import Vehicle

from .billing import ensure_policy_end_date
from .models import Policy, PolicyVehicle
from .services.vehicle_snapshot import ensure_policy_vehicle_snapshot

VEHICLE_OWNER_MISMATCH_ERROR = "El vehículo no pertenece al titular de la póliza."


class PolicyNumberConflict(APIException):
    status_code = 409
    default_detail = {"number": ["Policy number already exists."]}
    default_code = "policy_number_conflict"


class PolicyVehicleSerializer(serializers.ModelSerializer):
    def to_internal_value(self, data):
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


class BillingPeriodCurrentSerializer(serializers.ModelSerializer):
    period = serializers.CharField(source="period_code", read_only=True)
    due_soft = serializers.DateField(source="due_date_soft", read_only=True)
    due_hard = serializers.DateField(source="due_date_hard", read_only=True)

    class Meta:
        model = BillingPeriod
        fields = ["id", "period", "amount", "currency", "due_soft", "due_hard", "status"]


class PolicySerializer(serializers.ModelSerializer):
    # write-only (create/update)
    vehicle = PolicyVehicleSerializer(required=False, write_only=True, allow_null=True)
    license_plate = serializers.CharField(
        write_only=True, required=False, allow_blank=True, allow_null=True
    )
    vehicle_id = serializers.PrimaryKeyRelatedField(
        queryset=Vehicle.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )

    # read-only snapshots
    policy_vehicle = PolicyVehicleSerializer(source="contract_vehicle", read_only=True)

    # relations
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

    # computed fields
    product_name = serializers.SerializerMethodField()
    billing_period_current = serializers.SerializerMethodField()

    client_end_date = serializers.SerializerMethodField()
    payment_start_date = serializers.SerializerMethodField()
    payment_end_date = serializers.SerializerMethodField()

    # período de ajuste
    adjustment_from = serializers.SerializerMethodField()
    adjustment_to = serializers.SerializerMethodField()
    is_in_adjustment = serializers.SerializerMethodField()

    real_end_date = serializers.SerializerMethodField()

    has_pending_charge = serializers.SerializerMethodField()
    has_paid_in_window = serializers.SerializerMethodField()
    billing_status = serializers.SerializerMethodField()

    # soft-delete flags (si existen en el modelo)
    is_deleted = serializers.BooleanField(read_only=True, required=False)
    deleted_at = serializers.DateTimeField(read_only=True, required=False)

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
            "is_in_adjustment",
            "has_pending_charge",
            "has_paid_in_window",
            "claim_code",
            "billing_status",
            "billing_period_current",
            "policy_vehicle",
            "vehicle",
            "vehicle_id",
            "license_plate",
            "is_deleted",
            "deleted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {
            "number": {
                "required": False,
                "allow_null": True,
                "allow_blank": True,
                "validators": [],
            },
        }

    # -------------------------
    # Basic getters
    # -------------------------
    def get_product_name(self, obj):
        return getattr(obj.product, "name", None)

    def get_client_end_date(self, obj):
        return self._timeline_value(obj, "client_end_date")

    def get_payment_start_date(self, obj):
        return self._timeline_value(obj, "payment_start_date")

    def get_payment_end_date(self, obj):
        return self._timeline_value(obj, "payment_end_date")

    def get_adjustment_from(self, obj):
        return self._timeline_value(obj, "adjustment_from") or self._get_adjustment_window(obj)[0]

    def get_adjustment_to(self, obj):
        return self._timeline_value(obj, "adjustment_to") or self._get_adjustment_window(obj)[1]

    def get_is_in_adjustment(self, obj):
        a_from, a_to = self._get_adjustment_window(obj)
        if not a_from or not a_to:
            return False

        today = timezone.localdate()

        def _to_date(v):
            if v is None:
                return None
            if isinstance(v, date):
                return v
            if isinstance(v, str):
                try:
                    return date.fromisoformat(v)
                except ValueError:
                    return None
            return None

        start = _to_date(a_from)
        end = _to_date(a_to)
        if not start or not end:
            return False
        return start <= today <= end

    def get_real_end_date(self, obj):
        return self._timeline_value(obj, "real_end_date") or getattr(obj, "end_date", None)

    # -------------------------
    # Billing helpers
    # -------------------------
    def get_has_pending_charge(self, obj):
        period = self._get_current_billing_period(obj)
        return bool(period and period.status != BillingPeriod.Status.PAID)

    def get_has_paid_in_window(self, obj):
        try:
            timeline = self.context.get("timeline_map", {}).get(obj.id, {})
            start = timeline.get("payment_start_date")
            end = timeline.get("payment_end_date")
            if not start or not end:
                return False

            start_d = date.fromisoformat(start) if isinstance(start, str) else start
            end_d = date.fromisoformat(end) if isinstance(end, str) else end

            payments = Payment.objects.filter(
                policy=obj,
                state="APR",
                created_at__date__gte=start_d,
                created_at__date__lte=end_d,
            )
            return payments.exists()
        except Exception:
            return False

    def get_billing_status(self, obj):
        period = self._get_current_billing_period(obj)
        if period:
            return period.status
        return obj.billing_status

    def get_billing_period_current(self, obj):
        period = self._get_current_billing_period(obj)
        if not period:
            return None
        return BillingPeriodCurrentSerializer(period).data

    # -------------------------
    # Timeline + adjustment cache
    # -------------------------
    def _timeline_value(self, obj, key):
        return self.context.get("timeline_map", {}).get(obj.id, {}).get(key)

    def _get_adjustment_window(self, obj):
        cache = getattr(self, "_adjustment_cache", None)
        if cache is None:
            cache = {}
            self._adjustment_cache = cache

        key = obj.pk or id(obj)
        if key in cache:
            return cache[key]

        timeline = self.context.get("timeline_map", {}).get(obj.id, {}) or {}
        cached_from = timeline.get("adjustment_from")
        cached_to = timeline.get("adjustment_to")
        if cached_from is not None or cached_to is not None:
            cache[key] = (cached_from, cached_to)
            return cache[key]

        settings_obj = getattr(self, "_settings_obj_cache", None)
        if settings_obj is None:
            try:
                from common.models import AppSettings

                settings_obj = AppSettings.get_solo()
            except Exception:
                settings_obj = None
            self._settings_obj_cache = settings_obj

        if not settings_obj:
            cache[key] = (None, None)
            return cache[key]

        end = getattr(obj, "end_date", None)
        try:
            window_days = int(getattr(settings_obj, "policy_adjustment_window_days", 0) or 0)
        except Exception:
            window_days = 0

        if not end or window_days <= 0:
            cache[key] = (None, None)
            return cache[key]

        adjustment_from = end - timedelta(days=window_days)
        adjustment_to = end - timedelta(days=1)
        cache[key] = (adjustment_from, adjustment_to)
        return cache[key]

    def _get_current_billing_period(self, obj):
        key = obj.pk or id(obj)
        cache = getattr(self, "_billing_period_cache", {})
        if key not in cache:
            request = self.context.get("request")
            is_admin = bool(
                request
                and (
                    getattr(request.user, "is_staff", False)
                    or getattr(request.user, "is_superuser", False)
                    or str(getattr(request, "path", "")).startswith("/api/admin/")
                )
            )
            cache[key] = (
                get_current_billing_period(obj) if is_admin else ensure_current_billing_period(obj)
            )
            self._billing_period_cache = cache
        return cache.get(key)

    # -------------------------
    # Validation + create/update
    # -------------------------
    def validate(self, attrs):
        data = super().validate(attrs)
        instance = getattr(self, "instance", None)

        if instance is not None and getattr(instance, "is_deleted", False):
            raise ValidationError(
                {"detail": "No se puede modificar una póliza eliminada. Restaurala primero."}
            )

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
        with transaction.atomic():
            validated_data = self._ensure_number(validated_data, allow_generate=True)
            validated_data = self._ensure_claim_code(validated_data)

            vehicle_payload = validated_data.pop("vehicle", None)
            vehicle_ref = validated_data.pop("vehicle_id", None)
            license_plate = validated_data.pop("license_plate", None)

            vehicle_data = self._clean_vehicle_data(vehicle_payload)
            if vehicle_ref is None and not vehicle_data and license_plate:
                vehicle_ref = self._resolve_or_create_vehicle_by_plate(
                    self._get_candidate_user(validated_data),
                    license_plate,
                )

            auto_number = False
            if not validated_data.get("number"):
                auto_number = True
                validated_data["number"] = self._generate_temp_number()

            policy = super().create(validated_data)

            if auto_number:
                final_number = self._generate_number_from_id(policy.id)
                policy.number = final_number
                policy.save(update_fields=["number"])

            self._assign_vehicle(policy, vehicle_ref, vehicle_data)
            self._ensure_contract_vehicle_snapshot(policy, vehicle_ref, vehicle_data)

            ensure_policy_end_date(policy)
            ensure_current_billing_period(policy)
            return policy

    def update(self, instance, validated_data):
        with transaction.atomic():
            validated_data = self._ensure_number(validated_data, allow_keep=True, instance=instance)
            validated_data = self._ensure_claim_code(validated_data, instance=instance)

            vehicle_payload = validated_data.pop("vehicle", None)
            vehicle_ref = validated_data.pop("vehicle_id", None)
            license_plate = validated_data.pop("license_plate", None)

            vehicle_data = self._clean_vehicle_data(vehicle_payload)
            if vehicle_ref is None and not vehicle_data and license_plate:
                vehicle_ref = self._resolve_or_create_vehicle_by_plate(
                    self._get_candidate_user(validated_data) or getattr(instance, "user", None),
                    license_plate,
                )

            should_refresh_period = any(
                k in validated_data for k in ("premium", "start_date", "end_date")
            )

            policy = super().update(instance, validated_data)

            ensure_policy_end_date(policy)
            if should_refresh_period:
                ensure_current_billing_period(policy)

            self._assign_vehicle(policy, vehicle_ref, vehicle_data)
            self._ensure_contract_vehicle_snapshot(policy, vehicle_ref, vehicle_data)
            return policy

    # -------------------------
    # Vehicle helpers
    # -------------------------
    def _clean_vehicle_data(self, vehicle_data):
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
        required = ["plate", "make", "model", "year"]
        missing = [field for field in required if not cleaned.get(field)]
        if missing:
            raise ValidationError(
                {"vehicle": ["Si enviás vehículo, indicá patente, marca, modelo y año."]}
            )
        return cleaned

    def _resolve_or_create_vehicle_by_plate(self, user, plate):
        if not plate:
            return None
        if not user:
            raise ValidationError({"license_plate": ["Indicá un usuario para asociar el vehículo."]})
        plate_norm = str(plate).strip().upper()
        if not plate_norm:
            return None
        vehicle, _ = Vehicle.objects.get_or_create(
            owner=user,
            license_plate=plate_norm,
            defaults={
                "vtype": "AUTO",
                "brand": "Desconocida",
                "model": "Sin modelo",
                "year": timezone.now().year,
                "use": "Particular",
                "fuel": "",
                "color": "Blanco",
            },
        )
        return vehicle

    def _assign_vehicle(self, policy, vehicle_ref, vehicle_data):
        assigned_vehicle = None
        if vehicle_ref is not None:
            self._validate_vehicle_owner(policy, vehicle_ref)
            if policy.vehicle_id != vehicle_ref.id:
                policy.vehicle = vehicle_ref
                policy.save(update_fields=["vehicle"])
            assigned_vehicle = vehicle_ref
            return assigned_vehicle

        if vehicle_data:
            vehicle = self._resolve_or_create_vehicle(policy, vehicle_data)
            if vehicle and policy.vehicle_id != vehicle.id:
                policy.vehicle = vehicle
                policy.save(update_fields=["vehicle"])
            assigned_vehicle = vehicle
        return assigned_vehicle

    def _ensure_contract_vehicle_snapshot(self, policy, vehicle_ref, vehicle_data):
        if not vehicle_ref and not vehicle_data:
            return None
        source_vehicle = vehicle_ref or getattr(policy, "vehicle", None)
        try:
            ensure_policy_vehicle_snapshot(
                policy,
                source_vehicle=source_vehicle,
                payload=vehicle_data,
                overwrite=False,
            )
        except DjangoValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else {"vehicle": exc.messages}
            raise ValidationError(detail) from exc

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
        user_id = policy.user_id or self._request_user_id()
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
        vehicle, _ = Vehicle.objects.get_or_create(
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

    # -------------------------
    # Number + claim code helpers
    # -------------------------
    def _normalize_number(self, raw_value):
        if raw_value is None:
            raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})
        value = str(raw_value).strip()
        if not value:
            raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})
        if value[:3].upper() != "SC-":
            raise ValidationError({"number": "El número de póliza debe comenzar con 'SC-'."})
        return "SC-" + value[3:]

    def _ensure_number(self, validated_data, allow_keep=False, instance=None, allow_generate=False):
        number = validated_data.get("number", None)

        if number not in (None, ""):
            normalized = self._normalize_number(number)
            self._validate_number_unique(normalized, instance=instance)
            validated_data["number"] = normalized
            return validated_data

        if allow_keep and instance is not None and instance.number:
            validated_data.pop("number", None)
            return validated_data

        if allow_generate:
            validated_data.pop("number", None)
            return validated_data

        raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})

    def _validate_number_unique(self, number, instance=None):
        qs = Policy.objects.filter(number__iexact=number)
        if instance is not None and getattr(instance, "pk", None):
            qs = qs.exclude(pk=instance.pk)
        if qs.exists():
            raise PolicyNumberConflict({"number": ["Policy number already exists."]})

    def _generate_temp_number(self):
        for _ in range(5):
            candidate = f"TMP-{secrets.token_hex(6).upper()}"
            if not Policy.objects.filter(number__iexact=candidate).exists():
                return candidate
        return f"TMP-{secrets.token_hex(8).upper()}"

    def _generate_number_from_id(self, policy_id):
        base = f"SC-{policy_id:06d}"
        if not Policy.objects.filter(number__iexact=base).exists():
            return base
        for _ in range(5):
            candidate = f"{base}-{secrets.token_hex(2).upper()}"
            if not Policy.objects.filter(number__iexact=candidate).exists():
                return candidate
        return f"{base}-{secrets.token_hex(4).upper()}"

    def _ensure_claim_code(self, validated_data, instance=None):
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

    # -------------------------
    # Representation override
    # -------------------------
    def to_representation(self, instance):
        data = super().to_representation(instance)
        # No pisar el write_only "vehicle": exponemos snapshot contractual
        data["vehicle"] = self._represent_policy_vehicle(getattr(instance, "contract_vehicle", None))
        return data

    def _represent_policy_vehicle(self, vehicle):
        if not vehicle:
            return None
        return PolicyVehicleSerializer(vehicle).data


class AdminPolicyCreateSerializer(PolicySerializer):
    end_date = serializers.DateField(read_only=True)

    @staticmethod
    def _add_months(start: date, months: int) -> date:
        if months == 0:
            return start
        year = start.year + (start.month - 1 + months) // 12
        month = (start.month - 1 + months) % 12 + 1
        from calendar import monthrange
        last_day = monthrange(year, month)[1]
        return date(year, month, min(start.day, last_day))

    def _compute_end_date(self, start_date: date) -> date:
        return self._add_months(start_date, 3)

    def validate(self, attrs):
        data = super(serializers.ModelSerializer, self).validate(attrs)
        instance = getattr(self, "instance", None)

        if instance is not None and getattr(instance, "is_deleted", False):
            raise ValidationError(
                {"detail": "No se puede modificar una póliza eliminada. Restaurala primero."}
            )

        # number obligatorio en create
        if instance is None:
            raw_number = data.get("number", None)
            if raw_number in (None, ""):
                raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})
            normalized = self._normalize_number(raw_number)
            self._validate_number_unique(normalized, instance=None)
            data["number"] = normalized

        premium = data.get("premium", getattr(instance, "premium", None))
        if premium is None:
            raise ValidationError({"premium": "Indicá el precio (premium)."})

        # start_date default hoy en create
        start_date = data.get("start_date", getattr(instance, "start_date", None))
        if not start_date and instance is None:
            start_date = timezone.localdate()
            data["start_date"] = start_date

        # end_date no editable
        data.pop("end_date", None)

        # Si admin toca vehículo explícitamente, validamos ownership.
        touches_vehicle = any(k in data for k in ("vehicle", "vehicle_id", "license_plate"))
        if touches_vehicle:
            self._validate_vehicle_owner_payload(data)

        return data

    def create(self, validated_data):
        start_date = validated_data.get("start_date") or timezone.localdate()
        validated_data["start_date"] = start_date
        validated_data["end_date"] = self._compute_end_date(start_date)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # FIX: persistir user SIEMPRE si vino en payload (aunque sea null)
        # (cuando el request manda "user_id", DRF lo mapea a "user" por source="user")
        if "user" in validated_data:
            instance.user = validated_data.pop("user")  # puede ser User o None
            instance.save(update_fields=["user", "updated_at"])
            instance.refresh_from_db(fields=["user_id"])

        if "number" in validated_data:
            raw_number = validated_data.get("number", None)
            if raw_number in (None, ""):
                raise ValidationError({"number": "Indicá el número de póliza (ej: SC-1234)."})
            normalized = self._normalize_number(raw_number)
            self._validate_number_unique(normalized, instance=instance)
            validated_data["number"] = normalized

        if "start_date" in validated_data:
            start_date = validated_data.get("start_date") or instance.start_date
            validated_data["start_date"] = start_date
            validated_data["end_date"] = self._compute_end_date(start_date)
            return super().update(instance, validated_data)

        if "premium" in validated_data:
            incoming_premium = validated_data.get("premium")
            premium_changed = incoming_premium is not None and incoming_premium != instance.premium
            if premium_changed:
                rollover_start = instance.end_date or instance.start_date or timezone.localdate()
                validated_data["start_date"] = rollover_start
                validated_data["end_date"] = self._compute_end_date(rollover_start)

        validated_data.pop("end_date", None)
        return super().update(instance, validated_data)


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
        return getattr(getattr(obj, "contract_vehicle", None), "plate", None)

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

    city = serializers.SerializerMethodField()
    has_garage = serializers.SerializerMethodField()
    is_zero_km = serializers.SerializerMethodField()
    usage = serializers.SerializerMethodField()
    has_gnc = serializers.SerializerMethodField()
    gnc_amount = serializers.SerializerMethodField()

    # --- COMPAT: mantener "user" como venía (id) ---
    user = serializers.IntegerField(source="user_id", read_only=True)

    # --- NUEVO: para que el front pueda mostrar el cliente sin romper compat ---
    user_obj = UserMinimalSerializer(source="user", read_only=True)

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
            "user_obj",
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

    def _get_vehicle(self, obj):
        try:
            return obj.contract_vehicle
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
