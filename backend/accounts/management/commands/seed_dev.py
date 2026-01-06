from django.core.management.base import BaseCommand
from django.conf import settings

from accounts.models import User


class Command(BaseCommand):
    help = "Seed de desarrollo: crea/ajusta usuarios de prueba con credenciales conocidas."

    def handle(self, *args, **options):
        # Seguridad: evitar ejecutar en entornos no-dev por accidente
        if not settings.DEBUG:
            self.stderr.write(self.style.ERROR("seed_dev solo se permite con DEBUG=True."))
            return

        admin, _ = User.objects.get_or_create(
            dni="99000001",
            defaults={"email": "admin@test.com", "first_name": "Admin", "last_name": "Test", "is_active": True},
        )
        admin.set_password("Admin12345!")
        admin.is_staff = True
        admin.is_superuser = True
        admin.is_active = True
        admin.save()

        user, _ = User.objects.get_or_create(
            dni="99000002",
            defaults={"email": "user@test.com", "first_name": "User", "last_name": "Test", "is_active": True},
        )
        user.set_password("User12345!")
        user.is_staff = False
        user.is_superuser = False
        user.is_active = True
        user.save()

        self.stdout.write(self.style.SUCCESS("OK: seed_dev aplicado."))
        self.stdout.write("Admin: dni=99000001 pass=Admin12345!")
        self.stdout.write("User : dni=99000002 pass=User12345!")
