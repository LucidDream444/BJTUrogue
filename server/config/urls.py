from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(request):
    return JsonResponse({"status": "ok", "service": "bjtu-rogue-server"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger"),
    path("api/feedback/", include("apps.feedback.urls")),
    path("api/telemetry/", include("apps.telemetry.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/profile/save/", include("apps.cloudsave.urls")),
    path("api/release/", include("apps.release.urls")),
]
