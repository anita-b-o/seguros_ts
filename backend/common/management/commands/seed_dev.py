from __future__ import annotations

import io
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from products.models import Product
from vehicles.models import Vehicle
from quotes.models import QuoteShare
from policies.models import Policy, PolicyInstallment
from payments.models import Payment


def _dummy_jpg(filename: str = "photo.jpg") -> SimpleUploadedFile:
    """
    Crea una imagen JPG dummy en memoria (1x1) para satisfacer ImageField.
    Requiere pillow (ya lo tenés en requirements).
    """
    from PIL import Image  # pillow

    img = Image.new("RGB", (1, 1), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile(filename, buf.read(), content_type="image/jpeg")


def _period_yyyymm(dt=None) -> str:
    dt = dt or timezone.now()
    return f"{dt.year:04d}{dt.month:02d}"


class Command(BaseCommand):
    help = "Seed DEV integral (usuarios + productos + vehículos + pólizas + cuotas + pagos + quote share)"

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("Limpiando datos previos..."))

        # Orden: hijos -> padres
        Payment.objects.all().delete()
        PolicyInstallment.objects.all().delete()
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
        # Vehículos
        # =========================
        v1 = Vehicle.objects.create(
            owner=user,
            license_plate="AA123BB",
            vtype="AUTO",
            brand="Toyota",
            model="Corolla",
            year=2020,
            use="Particular",
            fuel="Nafta",
            color="Blanco",
        )

        v2 = Vehicle.objects.create(
            owner=user,
            license_plate="AB456CD",
            vtype="AUTO",
            brand="Volkswagen",
            model="Golf",
            year=2018,
            use="Particular",
            fuel="Nafta",
            color="Gris",
        )

        self.stdout.write(self.style.SUCCESS("Vehículos creados"))

        # =========================
        # QuoteShare (quotes.QuoteShare) — requiere 4 fotos
        # =========================
        qs = QuoteShare.objects.create(
            plan_code=p_basic.code,
            plan_name=p_basic.name,
            phone="+54 221 555-0000",
            make=v1.brand,
            model=v1.model,
            version="1.8",
            year=v1.year,
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
        # Policies (policies.Policy)
        # =========================
        today = timezone.now().date()
        p1 = Policy.objects.create(
            number="POL-000001",
            user=user,
            product=p_basic,
            premium=Decimal("13500.00"),
            status="active",
            start_date=today,
            end_date=today + timezone.timedelta(days=365),
            vehicle=v1,
        )

        p2 = Policy.objects.create(
            number="POL-000002",
            user=user,
            product=p_full,
            premium=Decimal("31000.00"),
            status="active",
            start_date=today,
            end_date=today + timezone.timedelta(days=365),
            vehicle=v2,
        )

        self.stdout.write(self.style.SUCCESS("Pólizas creadas"))

        # =========================
        # Installments (policies.PolicyInstallment) — para probar ventanas de pago
        # =========================
        # Cuota 1 (pendiente) para p2
        instal = PolicyInstallment.objects.create(
            policy=p2,
            sequence=1,
            period_start_date=today,
            period_end_date=today + timezone.timedelta(days=30),
            payment_window_start=today - timezone.timedelta(days=3),
            payment_window_end=today + timezone.timedelta(days=10),
            due_date_display=today + timezone.timedelta(days=10),
            due_date_real=today + timezone.timedelta(days=10),
            amount=Decimal("31000.00"),
            status=PolicyInstallment.Status.PENDING,
        )

        # =========================
        # Payments (payments.Payment)
        # =========================
        # Pago pendiente asociado a cuota (p2)
        Payment.objects.create(
            policy=p2,
            installment=instal,
            period=_period_yyyymm(),
            amount=Decimal("31000.00"),
            state="PEN",
            mp_preference_id="pref_test_0001",
            mp_payment_id="",
        )

        # Pago aprobado para p1 (sin cuota)
        Payment.objects.create(
            policy=p1,
            period=_period_yyyymm(),
            amount=Decimal("13500.00"),
            state="APR",
            mp_preference_id="pref_test_0002",
            mp_payment_id="pay_test_0002",
        )

        self.stdout.write(self.style.SUCCESS("Pagos creados"))
        self.stdout.write(self.style.SUCCESS("Seed DEV COMPLETO ✔"))

        # Ayuda rápida para testeo manual
        self.stdout.write(self.style.SUCCESS("Rutas útiles:"))
        self.stdout.write(self.style.SUCCESS(f"- Quote share: /api/quotes/share/{qs.token}"))
        self.stdout.write(self.style.SUCCESS("- Admin products: /api/admin/products/insurance-types (mapea a Product en tu backend)"))
