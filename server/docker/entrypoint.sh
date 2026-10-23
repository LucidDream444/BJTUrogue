#!/bin/sh
set -e

# 迁移 + 建三角色（幂等），再启动 gunicorn
python manage.py migrate --noinput
python manage.py setup_roles || true

exec "$@"
