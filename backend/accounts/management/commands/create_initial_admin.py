import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Crea (o actualiza) un usuario administrador inicial para entrar al panel."

    def handle(self, *args, **options):
        User = get_user_model()

        def read_env(key, default):
            value = os.getenv(key)
            if value is None and settings.DEBUG:
                return default
            return value

        email = (read_env("INITIAL_ADMIN_EMAIL", "admin@demo.com") or "").strip().lower()
        dni = (read_env("INITIAL_ADMIN_DNI", "99999999") or "").strip()
        password = read_env("INITIAL_ADMIN_PASSWORD", "demo1234")
        first_name = read_env("INITIAL_ADMIN_FIRST_NAME", "Admin") or "Admin"
        last_name = read_env("INITIAL_ADMIN_LAST_NAME", "Inicial") or "Inicial"

        if not settings.DEBUG:
            missing = []
            if not email:
                missing.append("INITIAL_ADMIN_EMAIL")
            if not dni:
                missing.append("INITIAL_ADMIN_DNI")
            if not password:
                missing.append("INITIAL_ADMIN_PASSWORD")
            if missing:
                raise CommandError(
                    "Faltan variables requeridas para producción: "
                    + ", ".join(missing)
                )

        # Buscamos por email o DNI
        user = User.objects.filter(email__iexact=email).first() or User.objects.filter(dni=dni).first()

        if user:
            user.email = user.email or email
            user.first_name = user.first_name or first_name
            user.last_name = user.last_name or last_name
            user.is_staff = True
            user.is_superuser = True
            if password:
                user.set_password(password)
            user.save()
            msg = f"Usuario admin actualizado: {user.email or user.dni}"
        else:
            user = User.objects.create_user(
                dni=dni,
                password=password,
                email=email,
                first_name=first_name,
                last_name=last_name,
                is_staff=True,
                is_superuser=True,
            )
            msg = f"Usuario admin creado: {user.email or user.dni}"

        self.stdout.write(self.style.SUCCESS(msg))
