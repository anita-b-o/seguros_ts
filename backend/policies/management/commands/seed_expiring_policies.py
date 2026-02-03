from datetime import date, timedelta

from django.core.management.base import BaseCommand

from accounts.models import User
from policies.management.commands._vehicle_helpers import ensure_policy_vehicle
from policies.models import Policy, PolicyInstallment
from products.models import Product


class Command(BaseCommand):
    help = "Crea algunas pólizas activas que entren en la sección 'Próximo a vencer'."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Borra las pólizas generadas anteriormente antes de recrear.",
        )

    def handle(self, *args, **options):
        today = date.today()
        user, _ = User.objects.get_or_create(
            email="demo-admin@seed.local",
            defaults={"dni": "31000001", "first_name": "Demo", "last_name": "Cliente", "is_staff": True, "is_superuser": True},
        )

        product = Product.objects.filter(is_active=True).first()
        if not product:
            self.stdout.write(self.style.ERROR("No hay productos publicados para asociar a las pólizas."))
            return

        seeds = [
            dict(
                number="SEED-EXP-01",
                plate="EXP001AA",
                make="Ford",
                model="Ka",
                year=2019,
                premium=17000,
            ),
            dict(
                number="SEED-EXP-02",
                plate="EXP002BB",
                make="Peugeot",
                model="208",
                year=2020,
                premium=18500,
            ),
        ]

        policy_numbers = [item["number"] for item in seeds]
        if options.get("reset"):
            PolicyInstallment.objects.filter(policy__number__in=policy_numbers).delete()
            Policy.objects.filter(number__in=policy_numbers).delete()

        for idx, seed in enumerate(seeds):
            start = today - timedelta(days=90 + idx * 5)
            end = start + timedelta(days=180)
            policy, _ = Policy.objects.update_or_create(
                number=seed["number"],
                defaults={
                    "user": user,
                    "product": product,
                    "premium": seed["premium"],
                    "status": "active",
                    "start_date": start,
                    "end_date": end,
                    "holder_dni": getattr(user, "dni", None),
                },
            )
            ensure_policy_vehicle(
                policy,
                {
                    "plate": seed["plate"],
                    "make": seed["make"],
                    "model": seed["model"],
                    "year": seed["year"],
                    "city": "CABA",
                },
            )
            policy.installments.all().delete()
            window_end = today - timedelta(days=2)
            real_due = today + timedelta(days=10)
            installment = PolicyInstallment(
                policy=policy,
                sequence=1,
                period_start_date=start,
                period_end_date=start + timedelta(days=30),
                payment_window_start=today - timedelta(days=14),
                payment_window_end=window_end,
                due_date_display=window_end,
                due_date_real=real_due,
                amount=policy.premium,
                status=PolicyInstallment.Status.NEAR_DUE,
            )
            installment.save()

        self.stdout.write(self.style.SUCCESS("Seed de pólizas próximas a vencer completado."))
