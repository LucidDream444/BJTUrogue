from django.contrib import admin, messages

from .models import FeedbackTicket
from .services import InvalidTransitionError, TicketWorkflowService


@admin.register(FeedbackTicket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "severity", "status", "client_version", "player", "created_at"]
    list_filter = ["status", "category", "severity", "client_version"]
    search_fields = ["title", "description", "player__anon_id"]
    readonly_fields = ["created_at", "updated_at", "closed_at", "player"]
    date_hierarchy = "created_at"
    actions = ["mark_classified", "mark_processing", "mark_verified", "close_tickets"]

    def _run(self, request, queryset, action):
        done = 0
        for ticket in queryset:
            try:
                action(ticket)
                done += 1
            except InvalidTransitionError as e:
                messages.error(request, f"工单「{ticket.title}」：{e}")
        messages.success(request, f"成功处理 {done} 个工单")

    @admin.action(description="标记为已分类")
    def mark_classified(self, request, queryset):
        self._run(request, queryset, TicketWorkflowService.classify)

    @admin.action(description="标记为处理中")
    def mark_processing(self, request, queryset):
        self._run(request, queryset, TicketWorkflowService.start_processing)

    @admin.action(description="标记为待验证")
    def mark_verified(self, request, queryset):
        self._run(request, queryset, TicketWorkflowService.verify)

    @admin.action(description="关闭工单")
    def close_tickets(self, request, queryset):
        self._run(request, queryset, TicketWorkflowService.close)
