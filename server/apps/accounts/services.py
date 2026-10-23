"""模块 B 业务逻辑：匿名 ID 处理、匿名档案、账号绑定（claim）。"""
import uuid

from django.utils import timezone

from .models import Player


class InvalidAnonIdError(ValueError):
    """anon_id 不是合法 UUID。"""


class ClaimConflictError(Exception):
    """匿名档案已被其它账号绑定。"""


class AnonymousIdService:
    @staticmethod
    def generate() -> uuid.UUID:
        return uuid.uuid4()

    @staticmethod
    def normalize(value):
        if isinstance(value, uuid.UUID):
            return value
        try:
            return uuid.UUID(str(value))
        except (ValueError, AttributeError, TypeError):
            return None


class PlayerService:
    @staticmethod
    def get_or_create(anon_id) -> Player:
        nid = AnonymousIdService.normalize(anon_id)
        if nid is None:
            raise InvalidAnonIdError("非法 anon_id")
        player, _ = Player.objects.get_or_create(anon_id=nid)
        return player

    @staticmethod
    def touch(player: Player, client_version: str | None = None) -> None:
        player.last_seen_at = timezone.now()
        if client_version:
            player.client_version = client_version[:32]
        player.save(update_fields=["last_seen_at", "client_version"])


class ClaimService:
    @staticmethod
    def claim(user, anon_id) -> Player:
        """把匿名档案绑定到账号；历史反馈/遥测经外键自动继承。

        冲突（该 anon_id 已被其它账号绑定）时抛 ClaimConflictError，
        由视图层转成 409。
        """
        nid = AnonymousIdService.normalize(anon_id)
        if nid is None:
            raise InvalidAnonIdError("非法 anon_id")
        player = Player.objects.filter(anon_id=nid).first()
        if player is None:
            return Player.objects.create(anon_id=nid, user=user)
        if player.user_id is None:
            player.user = user
            player.save(update_fields=["user"])
            return player
        if player.user_id != user.id:
            raise ClaimConflictError("该匿名档案已被其他账号绑定")
        return player
