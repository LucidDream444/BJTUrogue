"""Windows 部署扩展路由：在标准 urls 之上，把根路径 / 指向客户端 SPA 首页。"""
from pathlib import Path

from django.http import FileResponse
from django.urls import re_path

from .urls import *  # noqa: F401,F403


def _spa_index(request):
    index = Path(__file__).resolve().parent.parent / "game" / "index.html"
    return FileResponse(index.open("rb"), content_type="text/html")


urlpatterns += [
    re_path(r"^$", _spa_index),
]
