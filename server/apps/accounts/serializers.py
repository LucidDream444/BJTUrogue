from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    # 课程演示:密码只要求最短 8 位,不做"太常见/纯数字"等严格校验,避免注册莫名失败。
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["username", "password"]

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class ClaimSerializer(serializers.Serializer):
    anon_id = serializers.UUIDField()


class ClaimResponseSerializer(serializers.Serializer):
    claimed = serializers.BooleanField()
    anon_id = serializers.UUIDField()
    feedback_count = serializers.IntegerField()
    telemetry_count = serializers.IntegerField()
