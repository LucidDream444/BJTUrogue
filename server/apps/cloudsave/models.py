"""模块 D：云存档。账号可选地把本地 profile（D4 的 `ProfileData`）上传到云端，跨设备同步。

对齐 `docs/云存档接口草案.md`：每个账号一份记录，`payload` 是完整 `ProfileData` 的 JSON，
服务端不解释玩法数值（红线 2），只额外抽出 `schema_version`（红线 3 的迁移依据）与 `revision`
（并发令牌）。`revision` 取自 `payload.revision` —— 客户端单调递增的存档版本，服务端据此做
乐观并发：上传时带上 `base_revision`（客户端上次见到的云端修订号），不一致返回 409，
由客户端决定如何合并，**服务端绝不静默覆盖**。
"""
from django.conf import settings
from django.db import models


class CloudSave(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        verbose_name="账号",
        on_delete=models.CASCADE,
        related_name="cloud_save",
    )
    payload = models.JSONField("存档载荷", default=dict)
    schema_version = models.PositiveIntegerField("schema 版本", default=1)
    revision = models.PositiveIntegerField("修订号", default=0)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "云存档"
        verbose_name_plural = "云存档"

    def __str__(self):
        return f"{self.user.username} 的云存档（rev {self.revision}）"
