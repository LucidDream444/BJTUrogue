"""模块 B：匿名身份与账号体系。

`Player` 是服务端一切玩家侧数据的归属根：S1—S3 阶段 `user` 为空（纯匿名），
S4 绑定账号后填上，历史反馈 / 遥测通过外键自动继承，无需迁移。
"""
import uuid

from django.conf import settings
from django.db import models


class Player(models.Model):
    anon_id = models.UUIDField(
        "匿名ID", unique=True, db_index=True, default=uuid.uuid4, editable=False
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        verbose_name="绑定账号",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="player",
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    last_seen_at = models.DateTimeField("最近活跃", null=True, blank=True)
    client_version = models.CharField("客户端版本", max_length=32, blank=True)

    class Meta:
        verbose_name = "匿名档案"
        verbose_name_plural = "匿名档案"
        ordering = ["-created_at"]

    def __str__(self):
        return str(self.anon_id)

    def is_claimed(self) -> bool:
        return self.user_id is not None
