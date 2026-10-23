"""模块 C 业务逻辑：发布与回退的状态机约束。"""
from django.utils import timezone

from .models import Release, ReleaseStatus


class ReleaseService:
    @staticmethod
    def mark_verified(release: Release) -> None:
        if release.status != ReleaseStatus.CANDIDATE:
            raise ValueError("仅候选版本可标记为已验证")
        release.status = ReleaseStatus.VERIFIED
        release.save(update_fields=["status"])

    @staticmethod
    def release(release: Release, previous: Release | None = None) -> Release:
        if release.status != ReleaseStatus.VERIFIED:
            raise ValueError("仅已验证版本可发布")
        release.previous = previous
        release.status = ReleaseStatus.RELEASED
        release.released_at = timezone.now()
        release.save(update_fields=["previous", "status", "released_at"])
        return release

    @staticmethod
    def rollback(release: Release) -> Release:
        if release.previous_id is None:
            raise ValueError("无上一版本可回退")
        release.status = ReleaseStatus.ROLLED_BACK
        release.rolled_back_at = timezone.now()
        release.save(update_fields=["status", "rolled_back_at"])
        return release.previous
