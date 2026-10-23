from django.urls import path

from .views import TelemetryIngestView

urlpatterns = [
    path("events/", TelemetryIngestView.as_view(), name="telemetry-ingest"),
]
