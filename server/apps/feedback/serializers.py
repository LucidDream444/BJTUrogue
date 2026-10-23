from rest_framework import serializers

from .models import FeedbackTicket
from .services import FeedbackService


class FeedbackSerializer(serializers.ModelSerializer):
    anon_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = FeedbackTicket
        fields = [
            "id",
            "anon_id",
            "category",
            "severity",
            "title",
            "description",
            "repro_steps",
            "client_version",
            "client_platform",
            "attachment",
            "status",
            "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]

    def create(self, validated_data):
        anon_id = validated_data.pop("anon_id")
        return FeedbackService.create_ticket(anon_id, **validated_data)
