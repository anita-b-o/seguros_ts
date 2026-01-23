from __future__ import annotations

import io
from decimal import Decimal
from typing import Any

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import FieldDoesNotExist
from django.db import models
from django.utils import timezone

from accounts.models import User
from products.models import Product
from vehicles.models import Vehicle
from quotes.models import QuoteShare
from policies.models import Policy
from payments.billing import ensure_current_billing_period
from payments.models import BillingPeriod, Payment


def _dummy_jpg(filename: str = "photo.jpg") -> SimpleUploadedFile:
    """Crea una imagen JPG dummy (1x1) para satisfacer ImageField."""
    from PIL import Image  # pillow

    img = Image.new("RGB", (1, 1), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile(filename, buf.read(), content_type="image/jpeg")


def _model_field_names(model) -> set[str]:
    return {f.name for f in model._meta.get_fields()}

def _get_field(obj: Any, name: str):
    try:
        return obj._meta.get_field(name)
    except FieldDoesNotExist:
        return None


def _set_first_field(obj: Any, candidates: list[str], value: Any) -> bool:
    """
    Setea el primer campo existente (por nombre) en el objeto dentro de
    `candidates`. Devuelve True si pudo setear alguno.
    """
    field_names = _model_field_names(obj.__class__)
    for name in candidates:
        if name in field_names:
            setattr(obj, name, value)
            return True
    return False


def _require_first_field(obj: Any, candidates: list[str], value: Any, label: str) -> None:
    """
    Setea el primer campo existente y valida que haya uno disponible.
    """
    if not _set_first_field(obj, candidates, value):
        raise CommandError(f"No se encontró un campo válido para {label} en {obj.__class__.__name__}.")


def _create_vehicle(owner: User, **data) -> Vehicle:
    """
    Crea Vehicle adaptándose a nombres de campos comunes:
    plate/license_plate, make/brand, vtype/type, etc.
    """
    v = Vehicle()

    # owner
    _require_first_field(v, ["owner", "user"], owner, "owner/user")

    # patente
    _require_first_field(
        v,
        ["license_plate", "plate", "patent", "patente"],
        data.get("plate", ""),
        "license_plate/plate",
    )

    # tipo
    _require_first_field(
        v,
        ["vtype", "type", "vehicle_type"],
        data.get("vtype", "AUTO"),
        "vtype/type",
    )

    # marca/modelo
    _require_first_field(v, ["brand", "make"], data.get("make", ""), "brand/make")
    _require_first_field(v, ["model"], data.get("model", ""), "model")

    # opcionales
    _set_first_field(v, ["version", "trim"], data.get("version", ""))
    _require_first_field(v, ["year"], data.get("year"), "year")
    _set_first_field(v, ["city"], data.get("city", ""))
    _set_first_field(v, ["use", "usage"], data.get("use", "Particular"))
    _set_first_field(v, ["fuel"], data.get("fuel", "Nafta"))
    _set_first_field(v, ["color"], data.get("color", "Blanco"))

    v.full_clean(exclude=None)  # te avisa si algo obligatorio falta
    v.save()
    return v


def _create_policy(
    *,
    number: str,
    user: User,
    product: Product,
    premium: Decimal,
    status: str,
    start_date,
    end_date,
    vehicle: Vehicle | None = None,
    vehicle_payload: dict | None = None,
) -> Policy:
    """
    Crea Policy adaptándose a:
    - number vs policy_number
    - user vs owner/customer
    - product vs insurance_type
    - premium vs amount
    - vehicle FK vs JSON vehicle vs relation policy_vehicle
    """
    p = Policy()

    # number
    _require_first_field(p, ["number", "policy_number", "policyNumber"], number, "number")

    # user
    _require_first_field(p, ["user", "owner", "customer", "insured"], user, "user")

    # product
    _require_first_field(p, ["product", "insurance_type", "insuranceType"], product, "product")

    # premium
    _require_first_field(p, ["premium", "amount", "price"], premium, "premium")

    # status
    _set_first_field(p, ["status", "state"], status)

    # fechas
    _require_first_field(p, ["start_date", "startDate"], start_date, "start_date")
    _set_first_field(p, ["end_date", "endDate", "client_end_date"], end_date)

    # Vehículo: si existe FK "vehicle", usar instancia. Si no, usar payload JSON.
    if vehicle is not None:
        vehicle_field = _get_field(p, "vehicle")
        if vehicle_field and isinstance(vehicle_field, models.ForeignKey):
            _set_first_field(p, ["vehicle"], vehicle)
        else:
            payload_set = _set_first_field(
                p,
                ["vehicle_data", "vehicle_payload"],
                vehicle_payload or {},
            )
            if not payload_set and vehicle_payload:
                raise CommandError("No se encontró un campo válido para vehicle payload en Policy.")

    if vehicle_payload and not _get_field(p, "vehicle"):
        _set_first_field(p, ["vehicle_data", "vehicle_payload"], vehicle_payload)

    p.full_clean(exclude=None)
    p.save()
    return p


class Command(BaseCommand):
    help = "Seed DEV integral (usuarios + productos + vehículos + pólizas + pagos + quote share)"

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("Limpiando datos previos..."))

        # Orden: hijos -> padres
        Payment.objects.all().delete()
        BillingPeriod.objects.all().delete()
        Policy.objects.all().delete()
        QuoteShare.objects.all().delete()
        Vehicle.objects.all().delete()
        Product.objects.all().delete()
        User.objects.all().delete()

        self.stdout.write(self.style.SUCCESS("Datos previos eliminados"))

        # =========================
        # Usuarios (EMAIL-ONLY LOGIN)
        # =========================
        admin_email = "admin@seguros.test"
        user_email = "user@seguros.test"

        admin = User.objects.create_superuser(
            dni="99000001",
            email=admin_email.lower().strip(),
            password="Admin123!",
            first_name="Admin",
            last_name="Sistema",
        )

        user = User.objects.create_user(
            dni="99000002",
            email=user_email.lower().strip(),
            password="User12345!",
            first_name="Juan",
            last_name="Pérez",
        )

        self.stdout.write(self.style.SUCCESS("Usuarios creados (login por email)"))
        self.stdout.write(self.style.SUCCESS(f"Admin  → {admin_email} / Admin123!"))
        self.stdout.write(self.style.SUCCESS(f"Cliente→ {user_email} / User12345!"))

        # =========================
        # Productos (products.Product)
        # =========================
        p_basic = Product.objects.create(
            code="AUTO-RC",
            name="Auto RC",
            subtitle="Responsabilidad Civil",
            bullets=["Asistencia 24/7", "Responsabilidad civil", "Daños a terceros"],
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=2000,
            max_year=2100,
            base_price=Decimal("12000.00"),
            franchise="",
            coverages="- RC\n- Grúa\n- Asistencia",
            published_home=True,
            is_active=True,
        )

        p_full = Product.objects.create(
            code="AUTO-TR",
            name="Auto Todo Riesgo",
            subtitle="Cobertura total con franquicia",
            bullets=["Todo riesgo", "Granizo", "Robo total/parcial"],
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=2015,
            max_year=2100,
            base_price=Decimal("28000.00"),
            franchise="Franquicia $250.000",
            coverages="- TR\n- Granizo\n- Robo\n- Asistencia",
            published_home=True,
            is_active=True,
        )

        self.stdout.write(self.style.SUCCESS("Productos creados"))

        # =========================
        # Vehículos (robusto)
        # =========================
        v1 = _create_vehicle(
            owner=user,
            plate="AA123BB",
            vtype="AUTO",
            make="Toyota",
            model="Corolla",
            version="1.8",
            year=2020,
            city="La Plata",
            use="Particular",
            fuel="Nafta",
            color="Blanco",
        )

        v2 = _create_vehicle(
            owner=user,
            plate="AB456CD",
            vtype="AUTO",
            make="Volkswagen",
            model="Golf",
            version="1.4 TSI",
            year=2018,
            city="La Plata",
            use="Particular",
            fuel="Nafta",
            color="Gris",
        )

        self.stdout.write(self.style.SUCCESS("Vehículos creados"))

        # =========================
        # QuoteShare — requiere 4 fotos
        # =========================
        qs = QuoteShare.objects.create(
            plan_code=p_basic.code,
            plan_name=p_basic.name,
            phone="+54 221 555-0000",
            make="Toyota",
            model="Corolla",
            version="1.8",
            year=2020,
            city="La Plata",
            has_garage=True,
            is_zero_km=False,
            usage="privado",
            has_gnc=False,
            gnc_amount=None,
            photo_front=_dummy_jpg("front.jpg"),
            photo_back=_dummy_jpg("back.jpg"),
            photo_right=_dummy_jpg("right.jpg"),
            photo_left=_dummy_jpg("left.jpg"),
            expires_at=timezone.now() + timezone.timedelta(days=7),
        )

        self.stdout.write(self.style.SUCCESS(f"QuoteShare creada: token={qs.token}"))

        # =========================
        # Policies (robusto)
        # =========================
        today = timezone.localdate()
        end_12m = today + timezone.timedelta(days=365)

        vehicle_payload_1 = {
            "plate": "AA123BB",
            "make": "Toyota",
            "model": "Corolla",
            "version": "1.8",
            "year": 2020,
            "city": "La Plata",
        }
        vehicle_payload_2 = {
            "plate": "AB456CD",
            "make": "Volkswagen",
            "model": "Golf",
            "version": "1.4 TSI",
            "year": 2018,
            "city": "La Plata",
        }

        # Active + paid
        p1 = _create_policy(
            number="SC-000001",
            user=user,
            product=p_basic,
            premium=Decimal("13500.00"),
            status="active",
            start_date=today,
            end_date=end_12m,
            vehicle=v1,
            vehicle_payload=vehicle_payload_1,
        )

        # Active + pending
        p2 = _create_policy(
            number="SC-000002",
            user=user,
            product=p_full,
            premium=Decimal("31000.00"),
            status="active",
            start_date=today,
            end_date=end_12m,
            vehicle=v2,
            vehicle_payload=vehicle_payload_2,
        )

        # Cancelled/deleted (para “Pólizas eliminadas” en el panel)
        _create_policy(
            number="SC-000003",
            user=user,
            product=p_basic,
            premium=Decimal("11000.00"),
            status="cancelled",  # si tu backend usa "deleted"/"inactive", ajustalo acá
            start_date=today - timezone.timedelta(days=400),
            end_date=today - timezone.timedelta(days=35),
            vehicle=v1,
            vehicle_payload=vehicle_payload_1,
        )

        self.stdout.write(self.style.SUCCESS("Pólizas creadas (active + cancelled)"))

        # =========================
        # Payments (billing periods)
        # =========================
        # Periodo vigente pendiente (p2)
        bp2 = ensure_current_billing_period(p2)
        if not bp2:
            raise CommandError("No se pudo generar el BillingPeriod vigente para p2.")

        Payment.objects.create(
            policy=p2,
            billing_period=bp2,
            period=getattr(bp2, "period_code", None) or getattr(bp2, "period", None) or "",
            amount=getattr(bp2, "amount", None) or Decimal("0.00"),
            state="PEN",
            mp_preference_id="pref_test_0001",
            mp_payment_id="",
        )

        # Periodo vigente pagado (p1)
        bp1 = ensure_current_billing_period(p1)
        if not bp1:
            raise CommandError("No se pudo generar el BillingPeriod vigente para p1.")

        # Marcamos PAID si existe el enum Status
        if hasattr(BillingPeriod, "Status") and hasattr(BillingPeriod.Status, "PAID"):
            bp1.status = BillingPeriod.Status.PAID
            bp1.save(update_fields=["status", "updated_at"])
        elif hasattr(bp1, "status"):
            bp1.status = "PAID"
            bp1.save(update_fields=["status", "updated_at"])

        Payment.objects.create(
            policy=p1,
            billing_period=bp1,
            period=getattr(bp1, "period_code", None) or getattr(bp1, "period", None) or "",
            amount=getattr(bp1, "amount", None) or Decimal("0.00"),
            state="APR",
            mp_preference_id="pref_test_0002",
            mp_payment_id="pay_test_0002",
        )

        self.stdout.write(self.style.SUCCESS("Pagos creados"))
        self.stdout.write(self.style.SUCCESS("Seed DEV COMPLETO ✔"))

        self.stdout.write(self.style.SUCCESS("Rutas útiles:"))
        self.stdout.write(self.style.SUCCESS(f"- Quote share: /api/quotes/share/{qs.token}"))
        self.stdout.write(self.style.SUCCESS("- Admin policies: /api/admin/policies/policies"))
        self.stdout.write(self.style.SUCCESS("- Admin products: /api/admin/products/insurance-types"))
