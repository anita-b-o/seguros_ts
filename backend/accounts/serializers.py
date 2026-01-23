from rest_framework import serializers
from django.db import transaction
from django.utils.crypto import get_random_string

from .models import User
from policies.models import Policy


class UserSerializer(serializers.ModelSerializer):
    policy_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        allow_empty=True,
    )
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)

    def __init__(self, *args, **kwargs):
        """
        Solo los administradores pueden adjuntar/desvincular pólizas.
        Para otros contextos (p. ej. /users/me) se ignora policy_ids.
        """
        super().__init__(*args, **kwargs)
        self.allow_policy_ids = bool(self.context.get("allow_policy_ids"))
        # Seguridad: solo habilitar seteo directo de password en contextos admin.
        self.allow_password_set = bool(self.context.get("allow_password_set"))

    class Meta:
        model = User
        fields = (
            "id",
            "dni",
            "first_name",
            "last_name",
            "email",
            "phone",
            "birth_date",
            "is_staff",
            "is_active",
            "policy_ids",
            "password",
        )
        extra_kwargs = {
            "is_staff": {"read_only": True},
            "password": {"write_only": True, "required": False},
        }

    @transaction.atomic
    def update(self, instance, validated_data):
        """
        - Actualiza datos básicos y contraseña si viene en payload (solo si allow_password_set=True).
        - Solo los admins (allow_policy_ids=True) pueden vincular/desvincular pólizas via policy_ids.
        """
        policy_ids = validated_data.pop("policy_ids", None)
        email_update = validated_data.pop("email", None)
        is_active_update = validated_data.pop("is_active", None)
        password = (validated_data.pop("password", None) or "").strip()

        if self.allow_policy_ids:
            if email_update is not None:
                validated_data["email"] = email_update
            if is_active_update is not None:
                validated_data["is_active"] = is_active_update

        user = super().update(instance, validated_data)

        # Seguridad: solo admin puede setear password desde este serializer.
        if password and self.allow_password_set:
            user.set_password(password)
            user.save(update_fields=["password"])

        if self.allow_policy_ids and policy_ids is not None:
            ids = [int(pk) for pk in policy_ids if isinstance(pk, (int, str)) and str(pk).isdigit()]
            # Desasociar pólizas que ya no estén
            Policy.objects.filter(user=user).exclude(id__in=ids).update(user=None)
            # Asociar nuevas
            if ids:
                Policy.objects.filter(id__in=ids).update(user=user)

        return user

    @transaction.atomic
    def create(self, validated_data):
        policy_ids = validated_data.pop("policy_ids", [])
        if not self.allow_policy_ids:
            validated_data.pop("is_active", None)

        raw_password = (validated_data.pop("password", None) or "").strip()

        # Si admin no envía password, generamos uno utilizable.
        # Si no es admin, también generamos uno (manteniendo tu lógica).
        password = raw_password or get_random_string(12)

        dni = validated_data.pop("dni")
        user = User.objects.create_user(dni=dni, password=password, **validated_data)

        if self.allow_policy_ids and policy_ids:
            ids = [int(pk) for pk in policy_ids if isinstance(pk, (int, str)) and str(pk).isdigit()]
            if ids:
                Policy.objects.filter(id__in=ids).update(user=user)

        return user
