#!/bin/sh
# 容器启动初始化：依赖准备（npm ci）+ 生产构建（npm run build）随容器启动完成，
# 构建成功后在容器内 8080 端口启动静态服务器（vite preview，自带 SPA 路由回退）。
set -eu

cd /app

echo "[entrypoint] 安装依赖（npm ci）…"
npm ci --no-audit --no-fund

echo "[entrypoint] 生产构建（tsc --noEmit + vite build）…"
npm run build

echo "[entrypoint] 初始化完成，在 8080 端口启动静态服务 …"
exec npx vite preview --host 0.0.0.0 --port 8080
