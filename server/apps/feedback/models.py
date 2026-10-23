"""模块 A：反馈工单。状态机：提交 → 分类 → 处理 → 验证 → 关闭。"""
import uuid

from django.db import models


class FeedbackCategory(models.TextChoices):
    CRASH = "crash", "崩溃"
    PERFORMANCE = "performance", "性能"
    SAVE = "save", "存档"
    RULE = "rule", "规则"
    CLARITY = "clarity", "清晰度"
    OTHER = "other", "其他"


class FeedbackSeverity(models.TextChoices):
    LOW = "low", "低"
    MEDIUM = "medium", "中"
    HIGH = "high", "高"
    CRITICAL = "critical", "严重"


class TicketStatus(models.TextChoices):
    SUBMITTED = "submitted", "待分类"
    CLASSIFIED = "classified", "已分类"
    PROCESSING = "processing", "处理中"
    VERIFIED = "verified", "待验证"
    CLOSED = "closed", "已关闭"


class FeedbackTicket(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(
        "accounts.Player",
        verbose_name="匿名归属",
        on_delete=models.CASCADE,
        related_name="tickets",
    )
    category = models.CharField(
        "分类", max_length=20, choices=FeedbackCategory.choices, default=FeedbackCategory.OTHER
    )
    severity = models.CharField(
        "严重程度", max_length=20, choices=FeedbackSeverity.choices, default=FeedbackSeverity.LOW
    )
    status = models.CharField(
        "状态", max_length=20, choices=TicketStatus.choices, default=TicketStatus.SUBMITTED, db_index=True
    )
    title = models.CharField("标题", max_length=200)
    description = models.TextField("问题描述")
    repro_steps = models.TextField("复现步骤", blank=True)
    client_version = models.CharField("客户端版本", max_length=32)
    client_platform = models.CharField("客户端平台", max_length=64, blank=True)
    attachment = models.FileField("附件", upload_to="feedback/%Y/%m/", blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    closed_at = models.DateTimeField("关闭时间", null=True, blank=True)

    class Meta:
        verbose_name = "反馈工单"
        verbose_name_plural = "反馈工单"
        ordering = ["-created_at"]
        permissions = [
            ("change_status", "可以流转工单状态"),
            ("view_attachment", "可以查看工单附件"),
        ]

    def __str__(self):
        return self.title
