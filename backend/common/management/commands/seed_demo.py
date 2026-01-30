# backend/common/management/commands/seed_demo.py
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from common.models import AppSettings
from payments.billing import ensure_current_billing_period
from policies.models import Policy, PolicyVehicle
from products.models import Product
from vehicles.models import Vehicle  

User = get_user_model()


def _set_password_if_missing(user, raw_password: str):
    """
    Evita pisar passwords existentes sin querer.
    Si querés forzar reset, cambiá la condición.
    """
    if not user.has_usable_password():
        user.set_password(raw_password)


def _safe_setattr(obj, field: str, value):
    if hasattr(obj, field):
        setattr(obj, field, value)


def _get_or_create_user_by_email(*, email, defaults=None, password=None):
    defaults = defaults or {}
    user, created = User.objects.get_or_create(email=email, defaults=defaults)

    if not created:
        # opcional: actualizar datos base si querés
        for k, v in defaults.items():
            setattr(user, k, v)

    if password:
        user.set_password(password)  # CLAVE: nunca asignar user.password = "..."
    user.is_active = True
    user.save()

    return user, created


def _ensure_vehicle_for_user(*, owner: User, plate: str, brand: str, model: str, year: int) -> Vehicle:
    """
    Respeta constraint uniq_vehicle_owner_plate_ci (Lower(license_plate) + owner)
    """
    plate_norm = (plate or "").strip().upper()

    v = Vehicle.objects.filter(owner=owner, license_plate__iexact=plate_norm).first()
    if v:
        dirty = False
        if getattr(v, "brand", None) != brand:
            v.brand = brand
            dirty = True
        if getattr(v, "model", None) != model:
            v.model = model
            dirty = True
        if getattr(v, "year", None) != year:
            v.year = year
            dirty = True
        if dirty:
            v.save(update_fields=["brand", "model", "year", "updated_at"])
        return v

    v = Vehicle(
        owner=owner,
        license_plate=plate_norm,
        vtype="AUTO",
        brand=brand,
        model=model,
        year=year,
        use="Particular",
        fuel="Nafta",
        color="Blanco",
    )
    v.save()
    return v


class Command(BaseCommand):
    help = "Seed demo data: admin, clients, products, policies (+billing periods)"

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("🌱 Ejecutando seed DEMO…"))

        self.ensure_settings()
        self.ensure_admin()
        clients = self.ensure_clients()
        products = self.ensure_products()
        self.ensure_policies(clients, products)

        self.stdout.write(self.style.SUCCESS("✅ Seed DEMO finalizado correctamente"))

    # ------------------------------------------------------------------
    def ensure_settings(self):
        """
        IMPORTANT:
        No uses defaults con campos que pueden no existir (Django tira FieldError).
        Seteamos solo si el campo existe.
        """
        # Si AppSettings es singleton tipo solo, esto funciona igual porque habrá 0 o 1 fila.
        settings = AppSettings.objects.first()
        created = False
        if not settings:
            settings = AppSettings()
            created = True

        # Campos que sí sabemos que usás en views (según tu código):
        if hasattr(settings, "policy_adjustment_window_days") and getattr(settings, "policy_adjustment_window_days", None) in (None, 0):
            settings.policy_adjustment_window_days = 5

        if hasattr(settings, "default_term_months") and getattr(settings, "default_term_months", None) in (None, 0):
            settings.default_term_months = 3

        # Campos de ciclo de pago: seteamos solo si existen
        if hasattr(settings, "payment_window_days") and getattr(settings, "payment_window_days", None) in (None, 0):
            settings.payment_window_days = 10

        # ⚠️ Tu AppSettings NO tiene payment_early_due_days (por tu error), así que lo guardamos solo si existe
        if hasattr(settings, "payment_early_due_days") and getattr(settings, "payment_early_due_days", None) in (None, 0):
            settings.payment_early_due_days = 3

        settings.save()

        if created:
            self.stdout.write("✔ AppSettings creado + configurado")
        else:
            self.stdout.write("✔ AppSettings OK")

    # ------------------------------------------------------------------
    def ensure_admin(self):
        defaults = {
            "first_name": "Admin",
            "last_name": "San Cayetano",
            "dni": "90000000",  # único
            "is_staff": True,
            "is_superuser": True,
        }
        admin, created = _get_or_create_user_by_email(
            email="admin@sancayetano.com",
            defaults=defaults,
            password="admin123",
        )

        _safe_setattr(admin, "is_staff", True)
        _safe_setattr(admin, "is_superuser", True)
        if hasattr(admin, "dni") and not getattr(admin, "dni", None):
            admin.dni = defaults["dni"]
        admin.save()

        if created:
            self.stdout.write("✔ Admin creado (admin@sancayetano.com / admin123)")
        else:
            self.stdout.write("✔ Admin ya existente (admin@sancayetano.com)")

        return admin

    # ------------------------------------------------------------------
    def ensure_clients(self):
        clients = []

        demo_users = [
            {"email": "cliente1@test.com", "first_name": "Juan", "last_name": "Pérez", "dni": "40111111"},
            {"email": "cliente2@test.com", "first_name": "María", "last_name": "Gómez", "dni": "40222222"},
        ]

        for u in demo_users:
            defaults = {
                "first_name": u["first_name"],
                "last_name": u["last_name"],
                "dni": u["dni"],
            }
            user, created = _get_or_create_user_by_email(
                email=u["email"],
                defaults=defaults,
                password="cliente123",
            )

            if created:
                self.stdout.write(f"✔ Cliente creado: {u['email']} / cliente123")
            else:
                self.stdout.write(f"✔ Cliente ya existente: {u['email']}")

            clients.append(user)

        return clients

    # ------------------------------------------------------------------
    def ensure_products(self):
        demo_products = [
            {
                "code": "AUTO-RC",
                "name": "Auto RC",
                "subtitle": "Responsabilidad civil para circular protegido",
                "bullets": ["RC obligatoria", "Asistencia 24/7", "Gestión online"],
                "vehicle_type": "AUTO",
                "plan_type": "RC",
                "min_year": 1995,
                "max_year": 2100,
                "base_price": Decimal("12000.00"),
                "franchise": "",
                "coverages": "- Responsabilidad civil\n- Asistencia\n- Defensa legal",
                "published_home": True,
                "is_active": True,
                "home_order": 10,
            },
            {
                "code": "AUTO-TC",
                "name": "Auto Terceros Completo",
                "subtitle": "Robo, incendio y más coberturas",
                "bullets": ["Robo e incendio", "Granizo (según plan)", "Asistencia 24/7"],
                "vehicle_type": "AUTO",
                "plan_type": "TC",
                "min_year": 1995,
                "max_year": 2100,
                "base_price": Decimal("22000.00"),
                "franchise": "",
                "coverages": "- RC\n- Robo\n- Incendio\n- Cristales (según plan)\n- Asistencia",
                "published_home": True,
                "is_active": True,
                "home_order": 20,
            },
            {
                "code": "AUTO-TR",
                "name": "Auto Todo Riesgo",
                "subtitle": "Daños parciales con franquicia + robo/incendio",
                "bullets": ["Daños parciales", "Robo / incendio", "Asistencia premium"],
                "vehicle_type": "AUTO",
                "plan_type": "TR",
                "min_year": 1995,
                "max_year": 2100,
                "base_price": Decimal("38000.00"),
                "franchise": "Franquicia estándar",
                "coverages": "- RC\n- Todo riesgo (daños parciales con franquicia)\n- Robo\n- Incendio\n- Asistencia premium",
                "published_home": True,
                "is_active": True,
                "home_order": 30,
            },
            {
                "code": "MOTO-RC",
                "name": "Moto RC",
                "subtitle": "Responsabilidad civil para motos",
                "bullets": ["RC obligatoria", "Asistencia", "Emisión inmediata"],
                "vehicle_type": "MOTO",
                "plan_type": "RC",
                "min_year": 1995,
                "max_year": 2100,
                "base_price": Decimal("9000.00"),
                "franchise": "",
                "coverages": "- Responsabilidad civil\n- Asistencia",
                "published_home": True,
                "is_active": True,
                "home_order": 40,
            },
            {
                "code": "COM-TC",
                "name": "Comercial Terceros Completo",
                "subtitle": "Cobertura para vehículos de trabajo",
                "bullets": ["Terceros completo", "Asistencia", "Uso comercial"],
                "vehicle_type": "COM",
                "plan_type": "TC",
                "min_year": 1995,
                "max_year": 2100,
                "base_price": Decimal("26000.00"),
                "franchise": "",
                "coverages": "- RC\n- Robo\n- Incendio\n- Asistencia\n- Cristales (según plan)",
                "published_home": False,
                "is_active": True,
                "home_order": 50,
            },
        ]

        products = []
        for payload in demo_products:
            code = Product.normalize_code(payload["code"])
            defaults = dict(payload)
            defaults["code"] = code

            obj = Product.objects.filter(code__iexact=code).first()
            if not obj:
                obj = Product(**defaults)
                obj.save()
            else:
                dirty = False
                for k, v in defaults.items():
                    if getattr(obj, k) != v:
                        setattr(obj, k, v)
                        dirty = True
                if dirty:
                    obj.save()

            products.append(obj)

        self.stdout.write(f"✔ Productos DEMO asegurados: {len(products)}")
        return products

    # ------------------------------------------------------------------
    def ensure_policies(self, clients, products):
        today = timezone.localdate()

        demo_policies = [
            {
                "number": "SC-0001",
                "user": clients[0],
                "product": products[0],
                "vehicle": {"brand": "Toyota", "model": "Corolla", "year": 2018, "plate": "AB123CD"},
                "start_date": today - timedelta(days=30),
                "end_date": today + timedelta(days=60),
                "status": Policy.Status.ACTIVE if hasattr(Policy, "Status") else "active",
            },
            {
                "number": "SC-0002",
                "user": clients[0],
                "product": products[1],
                "vehicle": {"brand": "Ford", "model": "Ranger", "year": 2021, "plate": "AC456EF"},
                "start_date": today - timedelta(days=90),
                "end_date": today + timedelta(days=5),  # entra en ventana de ajuste
                "status": Policy.Status.ACTIVE if hasattr(Policy, "Status") else "active",
            },
            {
                "number": "SC-0003",
                "user": clients[1],
                "product": products[0],
                "vehicle": {"brand": "Volkswagen", "model": "Gol", "year": 2016, "plate": "AD789GH"},
                "start_date": today - timedelta(days=120),
                "end_date": today - timedelta(days=1),  # vencida
                "status": Policy.Status.ACTIVE if hasattr(Policy, "Status") else "active",
            },
        ]

        for p in demo_policies:
            policy = Policy.objects.filter(number=p["number"]).first()
            created = False

            if not policy:
                policy = Policy(number=p["number"])
                created = True

            # --- Vehicle real (FK Policy.vehicle) ---
            veh_real = _ensure_vehicle_for_user(
                owner=p["user"],
                plate=p["vehicle"]["plate"],
                brand=p["vehicle"]["brand"],
                model=p["vehicle"]["model"],
                year=p["vehicle"]["year"],
            )

            _safe_setattr(policy, "user", p["user"])
            _safe_setattr(policy, "product", p["product"])
            _safe_setattr(policy, "premium", getattr(p["product"], "base_price", 0) or 0)
            _safe_setattr(policy, "start_date", p["start_date"])
            _safe_setattr(policy, "end_date", p["end_date"])
            _safe_setattr(policy, "status", p["status"])
            _safe_setattr(policy, "vehicle", veh_real)

            if hasattr(policy, "is_deleted"):
                policy.is_deleted = False
            if hasattr(policy, "deleted_at"):
                policy.deleted_at = None

            policy.save()

            # --- Snapshot contractual (PolicyVehicle = legacy_vehicle) ---
            snap = PolicyVehicle.objects.filter(policy=policy).first()
            plate_norm = (p["vehicle"]["plate"] or "").strip().upper()

            if not snap:
                PolicyVehicle.objects.create(
                    policy=policy,
                    plate=plate_norm,
                    make=p["vehicle"]["brand"],  # ✅ make, no brand
                    model=p["vehicle"]["model"],
                    version="Demo",
                    year=p["vehicle"]["year"],
                    city="La Plata",
                    has_garage=False,
                    is_zero_km=False,
                    usage="privado",
                    has_gnc=False,
                    gnc_amount=None,
                )
            else:
                dirty = False
                if snap.plate != plate_norm:
                    snap.plate = plate_norm
                    dirty = True
                if snap.make != p["vehicle"]["brand"]:
                    snap.make = p["vehicle"]["brand"]
                    dirty = True
                if snap.model != p["vehicle"]["model"]:
                    snap.model = p["vehicle"]["model"]
                    dirty = True
                if snap.year != p["vehicle"]["year"]:
                    snap.year = p["vehicle"]["year"]
                    dirty = True
                if dirty:
                    snap.save()

            # --- BillingPeriod vigente ---
            ensure_current_billing_period(policy, now=today)

            if created:
                self.stdout.write(f"✔ Póliza creada: {policy.number}")
            else:
                self.stdout.write(f"✔ Póliza actualizada/asegurada: {policy.number}")
