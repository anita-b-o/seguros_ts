from rest_framework import serializers
from django.core.files.base import ContentFile
import base64
import re

from .models import QuoteShare, _generate_token

class QuoteInputSerializer(serializers.Serializer):
    vtype = serializers.ChoiceField(choices=['AUTO','MOTO','COM'])
    year = serializers.IntegerField(min_value=1970, max_value=2100)
    brand = serializers.CharField(required=False, allow_blank=True)
    model = serializers.CharField(required=False, allow_blank=True)
    use = serializers.CharField(required=False, allow_blank=True)


class DataURLImageField(serializers.ImageField):
    data_url_pattern = re.compile(r"^data:(image/\w+);base64,(.+)$")
    allowed_mimes = {"image/jpeg", "image/png", "image/jpg"}
    max_bytes = 5 * 1024 * 1024  # 5 MB por imagen

    def to_internal_value(self, data):
        if isinstance(data, str):
            match = self.data_url_pattern.match(data)
            if not match:
                raise serializers.ValidationError("Formato de imagen inválido.")
            mime, b64data = match.groups()
            if mime.lower() not in self.allowed_mimes:
                raise serializers.ValidationError("Formato no permitido. Usá JPG o PNG.")
            ext = mime.split("/")[-1]
            try:
                decoded = base64.b64decode(b64data)
            except (base64.binascii.Error, ValueError):
                raise serializers.ValidationError("No se pudo decodificar la imagen.")
            if len(decoded) > self.max_bytes:
                raise serializers.ValidationError("La imagen supera el límite de 5MB.")
            data = ContentFile(decoded, name=f"upload.{ext}")
        return super().to_internal_value(data)


class QuoteShareCreateSerializer(serializers.ModelSerializer):
    photos = serializers.DictField(child=DataURLImageField(), write_only=True)
    is_zero_km = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = QuoteShare
        fields = [
            "plan_code",
            "plan_name",
            "phone",
            "make",
            "model",
            "version",
            "year",
            "city",
            "has_garage",
            "is_zero_km",
            "usage",
            "has_gnc",
            "gnc_amount",
            "expires_at",
            "photos",
        ]

    def validate_photos(self, value):
        required_keys = {"front", "back", "right", "left"}
        missing = required_keys - set(value.keys())
        if missing:
            raise serializers.ValidationError(f"Faltan fotos: {', '.join(sorted(missing))}.")
        return value

    def create(self, validated_data):
        photos = validated_data.pop("photos", {})
        obj = QuoteShare(token=_generate_token(), **validated_data)
        obj.photo_front = photos.get("front")
        obj.photo_back = photos.get("back")
        obj.photo_right = photos.get("right")
        obj.photo_left = photos.get("left")
        obj.save()
        return obj


class QuoteShareCreateMultipartSerializer(serializers.Serializer):
    whatsapp = serializers.CharField()
    usage = serializers.CharField()
    make = serializers.CharField()
    model = serializers.CharField()
    version = serializers.CharField()
    year = serializers.IntegerField()
    locality = serializers.CharField()
    garage = serializers.BooleanField()
    gnc = serializers.BooleanField()
    gnc_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )

    photo_front = serializers.ImageField()
    photo_back = serializers.ImageField()
    photo_right = serializers.ImageField()
    photo_left = serializers.ImageField()


class QuoteShareSerializer(serializers.ModelSerializer):
    photos = serializers.SerializerMethodField()

    class Meta:
        model = QuoteShare
        fields = [
            "token",
            "plan_code",
            "plan_name",
            "phone",
            "make",
            "model",
            "version",
            "year",
            "city",
            "has_garage",
            "is_zero_km",
            "usage",
            "has_gnc",
            "gnc_amount",
            "expires_at",
            "photos",
            "created_at",
        ]

    def get_photos(self, obj):
        request = self.context.get("request")

        def abs_url(file_field):
            if not file_field:
                return None
            url = file_field.url
            if request:
                return request.build_absolute_uri(url)
            return url

        return {
            "front": abs_url(obj.photo_front),
            "back": abs_url(obj.photo_back),
            "right": abs_url(obj.photo_right),
            "left": abs_url(obj.photo_left),
        }
