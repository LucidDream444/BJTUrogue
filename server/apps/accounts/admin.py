from django.contrib import admin

from .models import Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ["anon_id", "user", "client_version", "last_seen_at", "created_at"]
    list_filter = ["client_version"]
    search_fields = ["anon_id", "user__username"]
    readonly_fields = ["anon_id", "created_at"]
