from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Player

from .models import TelemetryEvent

ANON = "7c9e6679-7425-40de-944b-e07fc1f90ae7"


class TelemetryIngestTest(APITestCase):
    def test_ingest_batch(self):
        resp = self.client.post(
            "/api/telemetry/events/",
            {
                "anon_id": ANON,
                "client_version": "0.3.1",
                "events": [
                    {
                        "name": "run_started",
                        "client_ts": "2026-10-15T12:00:00Z",
                        "payload": {"seed": 1, "characterId": "student", "difficulty": "normal"},
                    },
                    {
                        "name": "run_ended",
                        "client_ts": "2026-10-15T12:08:30Z",
                        "payload": {"result": "dead", "depth": 2, "kills": 41},
                    },
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(TelemetryEvent.objects.count(), 2)
        self.assertEqual(Player.objects.count(), 1)

    def test_invalid_payload_rejected(self):
        resp = self.client.post(
            "/api/telemetry/events/",
            {"anon_id": "bad", "client_version": "x", "events": []},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
