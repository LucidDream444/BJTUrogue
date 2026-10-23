from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import ClaimView, RegisterView

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("token/", TokenObtainPairView.as_view(), name="auth-token"),
    path("refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("claim/", ClaimView.as_view(), name="auth-claim"),
]
