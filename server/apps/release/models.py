"""模块 C：发布记录。真正的「切换 current 软链接」是文件系统/Caddy 操作，
这里只记录发布轨迹，保证每次发布/回退都有迹可查（UC11）。"""
from django.db import models


class ReleaseChannel(models.TextChoices):
    STABLE = "stable", "稳定版"


class ReleaseStatus(models.TextChoices):
    CANDIDATE = "candidate", "候选"
    VERIFIED = "verified", "已验证"
    RELEASED = "released", "已发布"
    ROLLED_BACK = "rolled_back", "已回退"


class Release(models.Model):
    version = models.CharField("版本号", max_length=32, unique=True)
    channel = models.CharField(
        "发布通道", max_length=16, choices=ReleaseChannel.choices, default=ReleaseChannel.STABLE
    )
    status = models.CharField(
        "状态", max_length=20, choices=ReleaseStatus.choices, default=ReleaseStatus.CANDIDATE
    )
    artifact_path = models.CharField("产物路径", max_length=256)
    release_notes = models.TextField("更新说明", blank=True)
    previous = models.ForeignKey(
        "self",
        verbose_name="上一版本",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="successors",
    )
    released_at = models.DateTimeField("发布时间", null=True, blank=True)
    rolled_back_at = models.DateTimeField("回退时间", null=True, blank=True)

    class Meta:
        verbose_name = "发布记录"
        verbose_name_plural = "发布记录"
        ordering = ["-released_at", "-version"]
        permissions = [
            ("publish", "可以发布版本"),
            ("rollback", "可以回退版本"),
        ]

    def __str__(self):
        return f"{self.version} ({self.get_status_display()})"
