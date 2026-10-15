from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import ClaimResponseSerializer, ClaimSerializer, RegisterSerializer
from .services import ClaimConflictError, ClaimService, InvalidAnonIdError

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]


class ClaimView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=ClaimSerializer,
        responses={200: ClaimResponseSerializer, 401: None, 409: None},
    )
    def post(self, request):
        ser = ClaimSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            player = ClaimService.claim(request.user, ser.validated_data["anon_id"])
        except ClaimConflictError:
            return Response(
                {"detail": "该匿名档案已被其他账号绑定"},
                status=status.HTTP_409_CONFLICT,
            )
        except InvalidAnonIdError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "claimed": True,
                "anon_id": str(player.anon_id),
                "feedback_count": player.tickets.count(),
                "telemetry_count": player.telemetry_events.count(),
            }
        )
