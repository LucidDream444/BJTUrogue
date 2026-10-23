from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.services import PlayerService

from .models import TelemetryEvent
from .serializers import TelemetryBatchSerializer


class TelemetryIngestView(APIView):
    """批量接收遥测事件。客户端 fire-and-forget，成功返回 202 后清本地队列。"""

    permission_classes = [AllowAny]

    @extend_schema(request=TelemetryBatchSerializer, responses={202: None})
    def post(self, request):
        ser = TelemetryBatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        player = PlayerService.get_or_create(data["anon_id"])
        events = [
            TelemetryEvent(
                player=player,
                event_name=item["name"],
                payload=item["payload"],
                client_version=data["client_version"],
                client_ts=item["client_ts"],
            )
            for item in data["events"]
        ]
        TelemetryEvent.objects.bulk_create(events, batch_size=500)
        return Response(status=status.HTTP_202_ACCEPTED)
