from django.urls import path

from .views import FeedbackCreateAPIView

urlpatterns = [
    path("", FeedbackCreateAPIView.as_view(), name="feedback-create"),
]
