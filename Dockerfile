# bunsai runtime worker image — bunsai itself runs inside the container.
# Everything is installed at build time: no npm fetch at runtime.
FROM oven/bun:1

ARG TARGETARCH
ARG DOCKER_CLI_VERSION=27.5.1

# Thin tool layer: git for steps that clone, curl for health checks, and the
# docker CLI for pipelines that talk to a mounted docker socket.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git tar \
 && rm -rf /var/lib/apt/lists/* \
 && arch=$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64) \
 && curl -fsSL "https://download.docker.com/linux/static/stable/${arch}/docker-${DOCKER_CLI_VERSION}.tgz" \
    | tar -xz --strip-components=1 -C /usr/local/bin docker/docker \
 && docker --version

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# The bin is the TS entry itself (#!/usr/bin/env bun): link it onto PATH.
RUN chmod +x src/cli.ts \
 && ln -sf /app/src/cli.ts /usr/local/bin/bunsai \
 && bunsai --version

WORKDIR /work
ENTRYPOINT ["bunsai"]
CMD ["--help"]
