"""Windows 原生部署专用设置：在标准 settings 之上加 whitenoise。

whitenoise 负责两件事：
- 在 URL 根路径托管客户端构建产物（dist，放在 BASE_DIR/game），index.html 落到 /；
- 在 /static/ 托管 Django 自身静态（admin 等，需先 collectstatic）。

Django 的 URL 路由仍处理 /api/* 与 /admin/*。
"""
from .settings import *  # noqa: F401,F403

INSTALLED_APPS = ["whitenoise.runserver_nostatic"] + INSTALLED_APPS

# GameCacheMiddleware 必须在 WhiteNoise 之前：WhiteNoise 在请求阶段直接返回，
# 放在它后面的响应中间件拿不到那个响应；放在它前面才能覆盖 Cache-Control。
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "config.game_cache.GameCacheMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
] + [m for m in MIDDLEWARE if m != "django.middleware.security.SecurityMiddleware"]

# 客户端 dist 就放在 server/game/ 下
WHITENOISE_ROOT = BASE_DIR / "game"

# 根路径 / 指向 SPA 首页（whitenoise 不处理裸 /）
ROOT_URLCONF = "config.urls_win"
