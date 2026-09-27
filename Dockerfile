# ---------- 构建阶段：依赖准备 + 初始化（随镜像构建一次完成） ----------
FROM node:20-alpine AS build
WORKDIR /app

# 优先复制依赖清单，利用 Docker 层缓存；npm ci 严格按 lockfile 完成依赖准备
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 复制源码并完成初始化（类型检查 + 生产构建）：
# 全部依赖安装与编译都在镜像构建阶段就绪，容器启动时无需任何额外初始化步骤
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---------- 运行阶段：nginx 托管静态产物，容器启动即就绪 ----------
FROM nginx:1.27-alpine AS runtime

# 单页应用路由回退配置
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
