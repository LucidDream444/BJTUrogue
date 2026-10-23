"""S5：创建三类维护角色并绑定权限（对应需求 §2.1）。

角色权限边界（《服务端与运维详细设计》§5.1）：
- 内容配置人员：提交/编辑候选版本，不能直接发布
- 技术维护人员：读遥测、看附件、发布与回退
- 测试人员：流转工单状态（标记验证）、编辑候选版本状态
"""
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

ROLES = {
    "内容配置人员": ["release.add_release", "release.change_release"],
    "技术维护人员": [
        "feedback.view_attachment",
        "telemetry.view_event",
        "release.publish",
        "release.rollback",
    ],
    "测试人员": ["feedback.change_status", "release.change_release"],
}


class Command(BaseCommand):
    help = "创建三类维护角色并绑定权限（幂等）"

    def handle(self, *args, **options):
        for name, codenames in ROLES.items():
            group, _ = Group.objects.get_or_create(name=name)
            for codename in codenames:
                app_label, code = codename.split(".")
                try:
                    perm = Permission.objects.get(
                        codename=code, content_type__app_label=app_label
                    )
                    group.permissions.add(perm)
                except Permission.DoesNotExist:
                    self.stderr.write(f"权限不存在：{codename}")
            self.stdout.write(
                f"角色「{name}」配置完成（{group.permissions.count()} 项权限）"
            )
