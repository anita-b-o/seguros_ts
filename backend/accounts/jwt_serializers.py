from django.contrib.auth import get_user_model
from django.contrib.auth.models import update_last_login
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.settings import api_settings


User = get_user_model()


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Token serializer that authenticates explicitly by email + password.
    """

    username_field = "email"
    default_error_messages = {
        "no_active_account": _("No active account found with the given credentials"),
        "invalid_credentials": _("No active account found with the given credentials"),
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["email"] = serializers.EmailField(
            required=True,
            write_only=True,
            error_messages={
                "required": _("El email es obligatorio."),
                "invalid": _("Ingrese un email válido."),
            },
        )

    def validate(self, attrs):
        email = attrs.get("email")
        password = attrs.get("password")

        if not email:
            raise serializers.ValidationError({"email": _("El email es obligatorio.")})
        if password is None or password == "":
            raise serializers.ValidationError({"password": _("La contraseña es obligatoria.")})

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            self.fail("invalid_credentials")

        if not user.check_password(password):
            self.fail("invalid_credentials")

        if not api_settings.USER_AUTHENTICATION_RULE(user):
            self.fail("no_active_account")

        refresh = self.get_token(user)
        data = {"refresh": str(refresh), "access": str(refresh.access_token)}

        if api_settings.UPDATE_LAST_LOGIN:
            update_last_login(None, user)

        return data
