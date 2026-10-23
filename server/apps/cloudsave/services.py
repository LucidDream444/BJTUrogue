"""模块 D 业务逻辑：云存档的读取与乐观并发写入。"""
from django.db import transaction

from .models import CloudSave


class SaveConflictError(Exception):
    """云端修订号与客户端 base_revision 不一致，禁止覆盖。"""

    def __init__(self, current_revision):
        self.current_revision = current_revision
        super().__init__(f"云端已更新到修订号 {current_revision}")


class CloudSaveService:
    @staticmethod
    def get(user) -> CloudSave | None:
        return CloudSave.objects.filter(user=user).first()

    @staticmethod
    def upload(user, *, profile, base_revision) -> CloudSave:
        """上传存档（对齐 `docs/云存档接口草案.md` 第四节）。

        `profile` 已由 serializer 校验过含整数 `schemaVersion` / `revision`；
        `revision` 直接作为云端修订号（客户端单调递增，可跨设备比较）。
        冲突判定：`base_revision` 与服务端当前 `revision` 不一致时抛 `SaveConflictError`。
        读改写放在事务里并 `select_for_update` 锁行，避免两个设备同时上传时
        各自读到同一 revision、后写覆盖先写（「绝不静默覆盖」的落地）。
        """
        schema_version = profile["schemaVersion"]
        profile_revision = profile["revision"]
        with transaction.atomic():
            save = CloudSave.objects.select_for_update().filter(user=user).first()
            if save is None:
                # 服务端还没有存档（或客户端认为不存在）：直接建立。
                return CloudSave.objects.create(
                    user=user,
                    payload=profile,
                    schema_version=schema_version,
                    revision=profile_revision,
                )
            if base_revision != save.revision:
                raise SaveConflictError(save.revision)
            save.payload = profile
            save.schema_version = schema_version
            save.revision = profile_revision
            save.save(update_fields=["payload", "schema_version", "revision"])
            return save

    @staticmethod
    def delete(user) -> bool:
        deleted, _ = CloudSave.objects.filter(user=user).delete()
        return deleted > 0
