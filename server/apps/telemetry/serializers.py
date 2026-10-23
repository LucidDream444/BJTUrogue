from rest_framework import serializers


class TelemetryEventItemSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=64)
    client_ts = serializers.DateTimeField()
    payload = serializers.JSONField(default=dict)


class TelemetryBatchSerializer(serializers.Serializer):
    anon_id = serializers.UUIDField()
    client_version = serializers.CharField(max_length=32)
    events = TelemetryEventItemSerializer(many=True)
