from django.contrib import admin

from .models import Release
from .services import ReleaseService


@admin.register(Release)
class ReleaseAdmin(admin.ModelAdmin):
    list_display = ["version", "channel", "status", "previous", "released_at", "rolled_back_at"]
    list_filter = ["status", "channel"]
    search_fields = ["version"]
    actions = ["mark_verified", "do_release"]

    @admin.action(description="标记为已验证")
    def mark_verified(self, request, queryset):
        for r in queryset:
            ReleaseService.mark_verified(r)

    @admin.action(description="发布")
    def do_release(self, request, queryset):
        for r in queryset:
            ReleaseService.release(r)
