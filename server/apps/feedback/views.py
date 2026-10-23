from rest_framework import generics
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny

from .models import FeedbackTicket
from .serializers import FeedbackSerializer


class FeedbackCreateAPIView(generics.CreateAPIView):
    queryset = FeedbackTicket.objects.all()
    serializer_class = FeedbackSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
