# server/ — 服务端（D5）

《课后勇者：异次元校园》服务端：**Django 5 + DRF + simplejwt + drf-spectacular + PostgreSQL**。
详细设计见 [`docs/服务端与运维详细设计.md`](../docs/服务端与运维详细设计.md)。

## 目录结构

```
server/
├── config/                 Django 项目配置（settings / urls / wsgi / asgi）
├── apps/
│   ├── accounts/           模块 B：匿名档案 Player + 注册/登录(JWT) + claim 绑定
│   ├── cloudsave/          模块 D：云存档（GET/PUT/DELETE /api/profile/save/）
│   ├── feedback/           模块 A：反馈工单 + 状态机流转 + Admin 看板
│   ├── telemetry/          模块 A：遥测事件批量接收
│   └── release/            模块 C：发布记录 + 发布/回退状态机
├── docker/                 Dockerfile + entrypoint
├── docker-compose.yml      caddy / web / db 三服务
├── Caddyfile               同域反代 + 静态产物
├── requirements.txt        依赖锁定
└── manage.py
```

## 本地运行（SQLite，无需装 Postgres）

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py setup_roles                        # 建三类维护角色（S5 RBAC）
python manage.py createsuperuser                    # 后台管理员
python manage.py runserver                           # http://localhost:8000
```

- 管理后台：`http://localhost:8000/admin/`
- OpenAPI 文档：`http://localhost:8000/api/docs/`
- 健康检查：`http://localhost:8000/api/health/`

## 生产部署（Docker Compose + Postgres）

```bash
cd server
docker compose up -d --build
```

## API（C3 契约，见 OpenAPI）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health/` | 无 | 健康检查 |
| POST | `/api/feedback/` | 匿名 anon_id | 提交反馈（multipart 含附件） |
| POST | `/api/telemetry/events/` | 匿名 anon_id | 批量接收遥测（fire-and-forget） |
| POST | `/api/auth/register/` | 无 | 注册 |
| POST | `/api/auth/token/` | 无 | simplejwt 获取 access/refresh |
| POST | `/api/auth/refresh/` | 无 | 刷新 access |
| POST | `/api/auth/claim/` | JWT | 匿名档案绑定账号 |
| GET | `/api/profile/save/` | JWT | 拉取云存档（无档 404） |
| PUT | `/api/profile/save/` | JWT | 上传云存档（`base_revision` 乐观并发，落后 409） |
| DELETE | `/api/profile/save/` | JWT | 清除云存档 |

## 测试

```bash
python manage.py test    # 24 个用例：反馈提交、工单状态机、遥测、claim、发布回退、云存档
```

## 三条红线在本域的落地

1. **游戏核心循环不 await 网络**：遥测/反馈均为 fire-and-forget，服务端只提供接收端点，客户端另建本地队列（见设计文档 §3.3）。
2. **配置数值不写死**：服务端不存储任何游戏平衡数值，全部留在客户端配置表。
3. **本地存档带 schemaVersion**：遥测载荷带 `payload_version`，客户端版本写入 `client_version`。
