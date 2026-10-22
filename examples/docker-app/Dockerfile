FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY src ./src

EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD curl -sf http://localhost:3000/healthz || exit 1

CMD ["bun", "src/server.ts"]
