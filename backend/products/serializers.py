# backend/products/serializers.py
from rest_framework import serializers
from .models import Product
from .utils import parse_coverages_markdown

PLAN_SUBTITLE = {
    "RC": "Responsabilidad Civil (RC)",
    "TC": "Terceros Completo",
    "TR": "Todo Riesgo",
    "BASIC": "Cobertura básica",
    "FULL": "Cobertura completa",
}

PLAN_TAG = {
    "RC": "Legal básico",
    "TC": "Popular",
    "TR": "Premium",
    "BASIC": "Económico",
    "FULL": "Completo",
}


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = "__all__"


class AdminProductSerializer(ProductSerializer):
    """
    Serializer laxo para el panel admin: acepta inputs parciales y completa defaults.
    """
    policy_count = serializers.IntegerField(read_only=True, required=False)

    class Meta(ProductSerializer.Meta):
        fields = (
            "id",
            "code",
            "name",
            "subtitle",
            "bullets",
            "vehicle_type",
            "plan_type",
            "min_year",
            "max_year",
            "base_price",
            "franchise",
            "coverages",
            "published_home",
            "home_order",
            "is_active",
            "policy_count",
        )
        extra_kwargs = {
            "vehicle_type": {"required": False},
            "plan_type": {"required": False},
            "min_year": {"required": False},
            "max_year": {"required": False},
            "base_price": {"required": False},
            "franchise": {"required": False},
            "coverages": {"required": False},
            "published_home": {"required": False},
            "home_order": {"required": False},
            "is_active": {"required": False},
            "bullets": {"required": False},
            "code": {"required": False, "allow_blank": True, "allow_null": True},
            "subtitle": {"required": False, "allow_blank": True},
        }

    def _apply_defaults(self, data, instance=None):
        d = {**(data or {})}
        current = instance

        d.setdefault("vehicle_type", getattr(current, "vehicle_type", "AUTO"))
        d.setdefault("plan_type", getattr(current, "plan_type", "TR"))
        d.setdefault("min_year", getattr(current, "min_year", 1995))
        d.setdefault("max_year", getattr(current, "max_year", 2100))
        d.setdefault("base_price", getattr(current, "base_price", 0))
        d.setdefault("franchise", getattr(current, "franchise", ""))
        d.setdefault("coverages", getattr(current, "coverages", ""))
        d.setdefault("published_home", getattr(current, "published_home", True))
        d.setdefault("home_order", getattr(current, "home_order", 0))
        d.setdefault("is_active", getattr(current, "is_active", True))
        d.setdefault("bullets", getattr(current, "bullets", []))

        if d.get("code"):
            d["code"] = Product.normalize_code(d["code"])

        if not d.get("code"):
            # si no hay code, generamos uno por name
            d["code"] = Product.generate_unique_code(d.get("name") or "PLAN", exclude_pk=getattr(current, "pk", None))

        # subtitle default opcional
        if "subtitle" not in d or d.get("subtitle") is None:
            d["subtitle"] = getattr(current, "subtitle", "") if current else ""

        return d

    def create(self, validated_data):
        return super().create(self._apply_defaults(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._apply_defaults(validated_data, instance))


class HomeProductSerializer(serializers.ModelSerializer):
    """
    Shape compatible con tu Home usando PlanCard/PlansSection:
    - name
    - subtitle
    - features (array de strings) -> se mapea desde bullets
    """
    tag = serializers.SerializerMethodField()
    features = serializers.SerializerMethodField()
    coverages_lite = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = ("id", "code", "name", "subtitle", "tag", "features", "coverages_lite")

    def get_tag(self, obj):
        key = (getattr(obj, "plan_type", "") or "").upper()
        return PLAN_TAG.get(key, "")

    def get_features(self, obj):
        bullets = getattr(obj, "bullets", None)
        if not bullets:
            return []
        try:
            cleaned = [str(b).strip() for b in list(bullets) if str(b).strip()]
            return cleaned[:5]
        except Exception:
            return []

    def get_coverages_lite(self, obj):
        cov = getattr(obj, "coverages", "") or ""
        parsed = parse_coverages_markdown(cov)
        if parsed:
            return parsed
        # fallback
        bullets = getattr(obj, "bullets", None)
        if bullets:
            cleaned = [str(item).strip() for item in bullets if str(item).strip()]
            return cleaned[:10]
        return []
