from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True, min_length=8, validators=[validate_password]
    )

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
