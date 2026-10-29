from rest_framework import serializers

from .models import CloudSave


class CloudSaveReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = CloudSave
        fields = ["payload", "schema_version", "revision", "updated_at"]
        read_only_fields = fields


class CloudSaveUploadSerializer(serializers.Serializer):
    """上传请求。`profile` 是完整 `ProfileData` 载荷（内部字段仍为客户端 camelCase，
    服务端不解释）；`base_revision` 是客户端上次见到的云端修订号（从未同步过填 0）。"""

    base_revision = serializers.IntegerField(min_value=0)
    profile = serializers.JSONField()

    def validate_profile(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("profile 必须是对象")
        schema_version = value.get("schemaVersion")
        revision = value.get("revision")
        if not isinstance(schema_version, int) or schema_version < 1:
            raise serializers.ValidationError("profile.schemaVersion 必须是 ≥1 的整数")
        if not isinstance(revision, int) or revision < 0:
            raise serializers.ValidationError("profile.revision 必须是 ≥0 的整数")
        return value
