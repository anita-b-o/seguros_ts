import datetime
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from products.models import Product
from policies.management.commands._vehicle_helpers import ensure_policy_vehicle
from policies.models import Policy
from payments.models import Receipt
from common.models import AppSettings


class Command(BaseCommand):
    help = "Crea datos demo alineados con el mock del frontend."

    def handle(self, *args, **options):
        User = get_user_model()

        # Usuarios
        admin, _ = User.objects.get_or_create(
            email="admin@demo.com",
            defaults={"dni": "99999999", "first_name": "Admin", "last_name": "Demo", "is_staff": True, "is_superuser": True},
        )
        admin.set_password("demo1234")
        admin.save()

        cliente, _ = User.objects.get_or_create(
            email="cliente@demo.com",
            defaults={"dni": "11111111", "first_name": "Cliente", "last_name": "Demo"},
        )
        cliente.set_password("demo1234")
        cliente.save()

        otro, _ = User.objects.get_or_create(
            email="otro@demo.com",
            defaults={"dni": "22222222", "first_name": "Otro", "last_name": "Usuario"},
        )
        otro.set_password("demo1234")
        otro.save()

        # Settings
        settings_obj = AppSettings.get_solo()
        settings_obj.expiring_threshold_days = 7
        settings_obj.client_expiration_offset_days = 2
        settings_obj.default_term_months = 3
        settings_obj.payment_window_days = 5
        settings_obj.policy_adjustment_window_days = 7
        settings_obj.save()

        # Productos
        products_data = [
            dict(code="PLAN_A", name="Responsabilidad Civil (RC)", subtitle="Cobertura básica obligatoria", bullets=["Daños a terceros", "Asistencia vial"]),
            dict(code="PLAN_B", name="Auto Total", subtitle="Cobertura por pérdida total", bullets=["PT por robo/incendio", "Asistencia 24/7"]),
            dict(code="PLAN_D", name="Todo Riesgo", subtitle="Cobertura integral", bullets=["Daños parciales", "Franquicia configurable"]),
            dict(code="PLAN_P", name="Mega Premium", subtitle="Cobertura tope de gama", bullets=["Auto sustituto", "Granizo sin tope"]),
        ]
        product_objs = {}
        for p in products_data:
            obj, _ = Product.objects.get_or_create(
                code=p["code"],
                defaults={
                    "name": p["name"],
                    "subtitle": p["subtitle"],
                    "bullets": p["bullets"],
                    "vehicle_type": "AUTO",
                    "plan_type": "TR",
                    "min_year": 1995,
                    "max_year": 2100,
                    "base_price": 20000,
                    "coverages": "\n".join(p["bullets"]),
                    "published_home": True,
                    "is_active": True,
                },
            )
            product_objs[p["code"]] = obj

        # Helper fechas
        def d(s): return datetime.date.fromisoformat(s)
        today = datetime.date.today()
        def rel(days): return today + datetime.timedelta(days=days)

        policies_data = [
            # Ventana de pago abierta ahora (pago mes en curso)
            {
                "id": 101,
                "number": "POL-000101",
                "user": cliente,
                "product": product_objs["PLAN_D"],
                "premium": 24500,
                "start_date": today,
                "end_date": rel(90),
                "status": "active",
                "claim_code": "VINCULA-101",
                "vehicle": dict(plate="AB123CD", make="Volkswagen", model="Gol", version="1.6", year=2018, city="La Plata", has_garage=True, usage="privado"),
            },
            # Pasó vencimiento adelantado pero aún no vencimiento real (aparece en Próximo a vencer)
            {
                "id": 102,
                "number": "POL-000102",
                "user": cliente,
                "product": product_objs["PLAN_B"],
                "premium": 19800,
                "start_date": rel(-7),
                "end_date": rel(60),
                "status": "active",
                "claim_code": "VINCULA-102",
                "vehicle": dict(plate="AE987FG", make="Chevrolet", model="Onix", version="1.4 LT", year=2019, city="La Plata", has_garage=False, usage="privado", has_gnc=True, gnc_amount=4000),
            },
            # Vencida (pasó vencimiento real)
            {
                "id": 103,
                "number": "POL-000103",
                "user": None,
                "product": product_objs["PLAN_A"],
                "premium": 12000,
                "start_date": rel(-40),
                "end_date": rel(-5),
                "status": "active",
                "claim_code": "VINCULA-103",
                "vehicle": dict(plate="AC456ZZ", make="Renault", model="Kwid", version="1.0", year=2022, city="Quilmes", has_garage=True, usage="privado"),
            },
            # Ajuste próximo (sigue activa, con pago futuro)
            {
                "id": 104,
                "number": "POL-000104",
                "user": otro,
                "product": product_objs["PLAN_P"],
                "premium": 41000,
                "start_date": rel(10),
                "end_date": rel(120),
                "status": "active",
                "claim_code": None,
                "vehicle": dict(plate="AF789GH", make="Toyota", model="Corolla", version="XEi", year=2021, city="CABA", has_garage=True, usage="comercial"),
            },
            # Inactiva (archivo)
            {
                "id": 105,
                "number": "POL-000105",
                "user": otro,
                "product": product_objs["PLAN_A"],
                "premium": 15000,
                "start_date": rel(-120),
                "end_date": rel(60),
                "status": "inactive",
                "claim_code": "VINCULA-105",
                "vehicle": dict(plate="AG321MN", make="Peugeot", model="208", version="Allure", year=2020, city="Berazategui", has_garage=False, usage="privado"),
            },
            # Suspendida
            {
                "id": 106,
                "number": "POL-000106",
                "user": admin,
                "product": product_objs["PLAN_D"],
                "premium": 36500,
                "start_date": rel(-15),
                "end_date": rel(200),
                "status": "suspended",
                "claim_code": "VINCULA-106",
                "vehicle": dict(plate="AK456XY", make="Ford", model="Focus", version="Titanium", year=2022, city="CABA", has_garage=True, usage="privado"),
            },
            # Cancelada
            {
                "id": 107,
                "number": "POL-000107",
                "user": admin,
                "product": product_objs["PLAN_B"],
                "premium": 22800,
                "start_date": rel(-200),
                "end_date": rel(30),
                "status": "cancelled",
                "claim_code": "VINCULA-107",
                "vehicle": dict(plate="AL789QP", make="Peugeot", model="208", version="Allure", year=2021, city="La Plata", has_garage=False, usage="privado", has_gnc=True, gnc_amount=4000),
            },
            # Próxima a pago (ventana abre en pocos días)
            {
                "id": 108,
                "number": "POL-000108",
                "user": cliente,
                "product": product_objs["PLAN_A"],
                "premium": 17500,
                "start_date": rel(3),
                "end_date": rel(90),
                "status": "active",
                "claim_code": "VINCULA-108",
                "vehicle": dict(plate="AN222BB", make="Fiat", model="Cronos", version="Drive", year=2023, city="Mar del Plata", has_garage=False, usage="privado"),
            },
        ]

        for pdata in policies_data:
            policy, _ = Policy.objects.update_or_create(
                number=pdata["number"],
                defaults={
                    "user": pdata["user"],
                    "product": pdata["product"],
                    "premium": pdata["premium"],
                    "start_date": pdata["start_date"],
                    "end_date": pdata["end_date"],
                    "status": pdata["status"],
                    "claim_code": pdata["claim_code"],
                },
            )
            ensure_policy_vehicle(policy, pdata["vehicle"])

        # Recibos demo
        receipts = [
            (101, {"date": d("2025-08-10"), "file": None}),
            (102, {"date": d("2025-07-05"), "file": None}),
            (106, {"date": d("2025-09-12"), "file": None}),
        ]
        for policy_number, data in receipts:
            try:
                policy = Policy.objects.get(number=f"POL-{policy_number:06d}" if isinstance(policy_number, int) else policy_number)
            except Policy.DoesNotExist:
                continue
            Receipt.objects.update_or_create(
                policy=policy,
                date=data["date"],
                defaults={"amount": policy.premium, "concept": "Cuota", "method": "EFECTIVO"},
            )

        self.stdout.write(self.style.SUCCESS("Datos demo creados/actualizados."))
