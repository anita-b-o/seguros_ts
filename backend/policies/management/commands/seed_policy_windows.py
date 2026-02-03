from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand

from accounts.models import User
from common.models import AppSettings
from policies.management.commands._vehicle_helpers import cleanup_owner_vehicles, ensure_policy_vehicle
from policies.models import Policy, PolicyInstallment
from products.models import Product


def _shift_months(base_date: date, months: int) -> date:
    m = base_date.month - 1 + months
    year = base_date.year + m // 12
    month = m % 12 + 1
    day = min(base_date.day, monthrange(year, month)[1])
    return date(year, month, day)


class Command(BaseCommand):
    help = """Seed focused demo data: users, products and policies grouped by their billing windows."""

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Elimina las pólizas creadas por este seed antes de volver a generarlas.",
        )

    def handle(self, *args, **options):
        today = date.today()
        settings_obj = AppSettings.get_solo()
        settings_obj.payment_window_days = 5
        settings_obj.client_expiration_offset_days = 1
        settings_obj.default_term_months = 3
        settings_obj.policy_adjustment_window_days = 7
        settings_obj.expiring_threshold_days = 7
        settings_obj.save()

        users = self._seed_users()
        products = self._seed_products()

        price_every = max(1, getattr(settings_obj, "default_term_months", 3) or 3)
        price_candidates = [today + timedelta(days=1), today + timedelta(days=2), today + timedelta(days=3)]

        policy_specs = []
        # Tres pólizas dentro de la ventana de ajuste de precio (price update)
        for idx, candidate in enumerate(price_candidates, start=1):
            start_date = _shift_months(candidate, -price_every)
            policy_specs.append(
                dict(
                    number=f"SEED-PW-{idx:02d}",
                    user=users["11000001"],
                    product=products["RC" if idx == 1 else "TR"],
                    premium=Decimal("21500") + Decimal(idx * 500),
                    start_date=start_date,
                    end_date=_shift_months(start_date, price_every * 4),
                    status="active",
                    vehicle=dict(
                        plate=f"PW{idx}AA",
                        make="Fiat",
                        model="Cronos",
                        version="Confort",
                        year=2019,
                        city="La Plata",
                        has_garage=True,
                        is_zero_km=False,
                        usage="privado",
                        has_gnc=False,
                        gnc_amount=None,
                    ),
                    window_type="price",
                    candidate=candidate,
                )
            )

        # Dos pólizas en periodo Próximo a vencer
        near_due_data = [
            dict(number="SEED-ND-01", plate="ND001XY", make="Honda", model="Civic", version="EX", year=2020),
            dict(number="SEED-ND-02", plate="ND002YZ", make="Peugeot", model="208", version="Allure", year=2022),
        ]
        for idx, data in enumerate(near_due_data, start=1):
            start_date = today - timedelta(days=60)
            policy_specs.append(
                dict(
                    number=data["number"],
                    user=users["11000002"],
                    product=products["TC"],
                    premium=Decimal("19800") + Decimal(idx * 1200),
                    start_date=start_date,
                    end_date=start_date + timedelta(days=365),
                    status="active",
                    vehicle=dict(
                        plate=data["plate"],
                        make=data["make"],
                        model=data["model"],
                        version=data["version"],
                        year=data["year"],
                        city="CABA",
                        has_garage=False,
                        is_zero_km=False,
                        usage="privado",
                        has_gnc=True,
                        gnc_amount=Decimal("45000"),
                    ),
                    window_type="near_due",
                )
            )

        # Cinco pólizas activas fuera de las ventanas
        for idx in range(1, 6):
            start_offset = idx * 90
            start_date = today - timedelta(days=start_offset)
            policy_specs.append(
                dict(
                    number=f"SEED-ACT-{idx:02d}",
                    user=users["11000003"],
                    product=products["RC"],
                    premium=Decimal("14500") + Decimal(idx * 800),
                    start_date=start_date,
                    end_date=start_date + timedelta(days=365),
                    status="active",
                    vehicle=dict(
                        plate=f"ACT{idx:02d}BB",
                        make="Renault",
                        model="Kwid",
                        version="Life",
                        year=2021,
                        city="Florencio Varela",
                        has_garage=False,
                        is_zero_km=False,
                        usage="privado",
                        has_gnc=False,
                        gnc_amount=None,
                    ),
                    window_type="active",
                )
            )

        policy_numbers = [spec["number"] for spec in policy_specs]
        if options.get("reset"):
            PolicyInstallment.objects.filter(policy__number__in=policy_numbers).delete()
            Policy.objects.filter(number__in=policy_numbers).delete()
            owner_ids = list(User.objects.filter(dni__in=["11000001", "11000002", "11000003"]).values_list("id", flat=True))
            cleanup_owner_vehicles(owner_ids)

        policies = {}
        for spec in policy_specs:
            policy, _ = Policy.objects.update_or_create(
                number=spec["number"],
                defaults={
                    "user": spec["user"],
                    "product": spec["product"],
                    "premium": spec["premium"],
                    "status": spec["status"],
                    "start_date": spec["start_date"],
                    "end_date": spec["end_date"],
                    "holder_dni": getattr(spec["user"], "dni", None),
                },
            )
            ensure_policy_vehicle(policy, spec["vehicle"])
            policies[spec["number"]] = policy

        installment_plan = self._build_installments_for(policies, today)
        for number, installments in installment_plan.items():
            self._apply_installments(policies[number], installments)

        self.stdout.write(self.style.SUCCESS("Seed de ventanas de pólizas cargado."))

    def _seed_users(self):
        data = [
            dict(dni="11000001", first_name="Lucia", last_name="Sanchez", email="lucia.seed@example.com", phone="1131110001"),
            dict(dni="11000002", first_name="Mateo", last_name="Lopez", email="mateo.seed@example.com", phone="1131110002"),
            dict(dni="11000003", first_name="Nora", last_name="Cabral", email="nora.seed@example.com", phone="1131110003"),
        ]
        users = {}
        for entry in data:
            dni = entry.pop("dni")
            password = entry.pop("password", "demo1234")
            user, _ = User.objects.get_or_create(dni=dni, defaults=entry)
            if password:
                user.set_password(password)
                user.save()
            users[dni] = user
        return users

    def _seed_products(self):
        entries = [
            dict(code="RC", name="Responsabilidad civil demo", plan_type="RC", vehicle_type="AUTO", base_price=Decimal("13000"), bullets=["Daños a terceros", "Cobertura mínima"], coverages="- Daños a terceros\n- Asistencia vial"),
            dict(code="TC", name="Terceros completo demo", plan_type="TC", vehicle_type="AUTO", base_price=Decimal("19500"), bullets=["Daños totales", "Cristales"], coverages="- Daños totales\n- Cristales"),
            dict(code="TR", name="Todo riesgo demo", plan_type="TR", vehicle_type="AUTO", base_price=Decimal("36000"), bullets=["Cobertura integral", "Granizo"], coverages="- Daños parciales\n- Granizo"),
        ]
        product_map = {}
        for entry in entries:
            obj, _ = Product.objects.update_or_create(
                code=entry["code"],
                defaults={
                    "name": entry["name"],
                    "vehicle_type": entry["vehicle_type"],
                    "plan_type": entry["plan_type"],
                    "min_year": 1995,
                    "max_year": 2035,
                    "base_price": entry["base_price"],
                    "franchise": "",
                    "coverages": entry["coverages"],
                    "bullets": entry["bullets"],
                    "published_home": False,
                    "is_active": True,
                },
            )
            product_map[entry["code"]] = obj
        return product_map

    def _build_installments_for(self, policies, today):
        config = {}
        for number, policy in policies.items():
            if number.startswith("SEED-PW"):
                window_end = today + timedelta(days=10 if number.endswith("01") else 12 if number.endswith("02") else 14)
                config[number] = [
                    dict(
                        sequence=1,
                        period_start=policy.start_date,
                        payment_window_start=policy.start_date,
                        payment_window_end=window_end,
                        due_date_real=window_end + timedelta(days=3),
                        amount=policy.premium,
                        status=PolicyInstallment.Status.PENDING,
                    )
                ]
            elif number.startswith("SEED-ND"):
                window_end = today - timedelta(days=1)
                config[number] = [
                    dict(
                        sequence=1,
                        period_start=today - timedelta(days=25),
                        payment_window_start=today - timedelta(days=30),
                        payment_window_end=window_end,
                        due_date_real=window_end + timedelta(days=5),
                        amount=policy.premium,
                        status=PolicyInstallment.Status.NEAR_DUE,
                    )
                ]
            else:
                window_end = today + timedelta(days=20 + int(number.split("-")[-1]) * 2)
                config[number] = [
                    dict(
                        sequence=1,
                        period_start=policy.start_date,
                        payment_window_start=policy.start_date,
                        payment_window_end=window_end,
                        due_date_real=window_end + timedelta(days=4),
                        amount=policy.premium,
                        status=PolicyInstallment.Status.PENDING,
                    )
                ]
        return config

    def _apply_installments(self, policy, installment_defs):
        policy.installments.all().delete()
        instances = []
        for inst in installment_defs:
            period_start = inst.get("period_start") or policy.start_date or date.today()
            period_end = inst.get("period_end") or (_shift_months(period_start, 1) - timedelta(days=1))
            payment_window_start = inst.get("payment_window_start") or period_start
            payment_window_end = inst["payment_window_end"]
            due_display = inst.get("due_date_display", payment_window_end)
            due_real = inst["due_date_real"]
            amount = inst.get("amount", policy.premium or Decimal("0"))
            instances.append(
                PolicyInstallment(
                    policy=policy,
                    sequence=inst["sequence"],
                    period_start_date=period_start,
                    period_end_date=period_end,
                    payment_window_start=payment_window_start,
                    payment_window_end=payment_window_end,
                    due_date_display=due_display,
                    due_date_real=due_real,
                    amount=amount,
                    status=inst.get("status", PolicyInstallment.Status.PENDING),
                )
            )
        PolicyInstallment.objects.bulk_create(instances)
