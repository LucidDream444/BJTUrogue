"""模块 A：遥测事件。只收低频里程碑事件（run_started / room_cleared / run_ended / app_error）。"""
import uuid

from django.db import models


class TelemetryEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(
        "accounts.Player",
        verbose_name="匿名归属",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="telemetry_events",
    )
    event_name = models.CharField("事件名", max_length=64, db_index=True)
    payload = models.JSONField("载荷", default=dict)
    payload_version = models.PositiveIntegerField("载荷版本", default=1)
    client_version = models.CharField("客户端版本", max_length=32)
    client_ts = models.DateTimeField("客户端时间")
    received_at = models.DateTimeField("接收时间", auto_now_add=True)

    class Meta:
        verbose_name = "遥测事件"
        verbose_name_plural = "遥测事件"
        ordering = ["-received_at"]
        indexes = [models.Index(fields=["event_name", "client_version", "received_at"])]
        permissions = [("view_event", "可以查看遥测事件")]

    def __str__(self):
        return self.event_name
