from django.contrib import admin

from .models import TelemetryEvent


@admin.register(TelemetryEvent)
class TelemetryEventAdmin(admin.ModelAdmin):
    list_display = ["event_name", "client_version", "client_ts", "received_at", "player"]
    list_filter = ["event_name", "client_version"]
    search_fields = ["event_name", "player__anon_id"]
    readonly_fields = [
        "player",
        "event_name",
        "payload",
        "payload_version",
        "client_version",
        "client_ts",
        "received_at",
    ]
