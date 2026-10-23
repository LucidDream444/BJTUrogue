from django.urls import path

from .views import CloudSaveView

urlpatterns = [
    path("", CloudSaveView.as_view(), name="cloud-save"),
]
