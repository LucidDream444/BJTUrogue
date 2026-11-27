"""Windows 静态资源缓存头：只给带内容哈希的构建产物长缓存。

`WHITENOISE_MAX_AGE` 是全局的，会把没有哈希的图片/音频也缓存一年；那些文件名
不随内容变化，发布后会长期拿旧图。所以这里按路径分流：

- `assets/main-<hash>.js` / `MainMenuScene-<hash>.js|css` / `test-...`：一年 immutable；
- `/config/*.json`、`/`、`/index.html`、`/test.html`：no-cache，发布立即生效；
- 其余 `/assets/*`（图片、音频等固定文件名）：短缓存 5 分钟。
"""
import re

_HASHED_BUILD_FILE = re.compile(
    r"^/assets/(?:main|MainMenuScene|test)-[A-Za-z0-9_-]+\.(?:js|css|map)$"
)


class GameCacheMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        path = request.path

        if _HASHED_BUILD_FILE.match(path):
            response["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path in ("/", "/index.html", "/test.html") or path.startswith("/config/"):
            response["Cache-Control"] = "no-cache"
        elif path.startswith("/assets/"):
            response["Cache-Control"] = "public, max-age=300"
        return response
