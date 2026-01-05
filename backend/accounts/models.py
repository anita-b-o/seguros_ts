from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager, Group, Permission


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, dni, email, password=None, **extra_fields):
        if not dni:
            raise ValueError("El DNI es obligatorio")
        if not email:
            raise ValueError("El email es obligatorio")
        dni = str(dni).strip()
        email = self.normalize_email(email or "").lower()
        user = self.model(dni=dni, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, dni, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser debe tener is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser debe tener is_superuser=True")
        if extra_fields.get("is_active") is not True:
            raise ValueError("Superuser debe tener is_active=True")

        return self.create_user(dni, email, password, **extra_fields)


class User(AbstractUser):
    # Sacamos username y usamos dni como identificador
    username = None
    email = models.EmailField(unique=True)

    groups = models.ManyToManyField(
        Group,
        related_name="accounts_user_set",
        blank=True,
        help_text="The groups this user belongs to.",
        verbose_name="groups",
    )
    user_permissions = models.ManyToManyField(
        Permission,
        related_name="accounts_user_permissions_set",
        blank=True,
        help_text="Specific permissions for this user.",
        verbose_name="user permissions",
    )

    dni = models.CharField(max_length=20, unique=True, db_index=True)
    phone = models.CharField(max_length=30, blank=True)
    birth_date = models.DateField(null=True, blank=True)

    USERNAME_FIELD = "dni"
    REQUIRED_FIELDS = ["email"]

    objects = UserManager()

    def __str__(self):
        return self.dni
