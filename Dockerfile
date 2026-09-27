# 依赖准备与初始化均在「容器启动时」完成（见 docker-entrypoint.sh）：
# 容器启动时先 npm ci 安装依赖、再 npm run build 完成生产构建（含 tsc 类型检查），
# 随后由 vite preview 在容器内 8080 端口托管静态产物（自带 SPA 路由回退）。
FROM node:20-alpine

WORKDIR /app

# 复制依赖清单与全部源码（容器启动时据此安装依赖并构建）
COPY package.json package-lock.json* ./
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# 容器启动初始化脚本：npm ci → npm run build → vite preview
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 浏览器入口固定为容器内 8080（compose 映射宿主机 8080 → 容器 8080）
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1

# 依赖安装与构建随容器启动执行；初始化完成后监听 8080
ENTRYPOINT ["docker-entrypoint.sh"]
