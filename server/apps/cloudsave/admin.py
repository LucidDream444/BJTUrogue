from django.contrib import admin

from .models import CloudSave


@admin.register(CloudSave)
class CloudSaveAdmin(admin.ModelAdmin):
    list_display = ["user", "schema_version", "revision", "updated_at"]
    list_filter = ["schema_version"]
    search_fields = ["user__username"]
    readonly_fields = ["revision", "updated_at"]
