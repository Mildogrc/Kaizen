# syntax=docker/dockerfile:1.7
# Kaizen: one small image with the Rust server and the prebuilt web app.
#   docker build -t kaizen .
#   docker run -p 8080:8080 --env-file .env kaizen

# ---- web (SolidJS + Vite) ----------------------------------------------------
FROM node:24-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- server (Rust) ------------------------------------------------------------
FROM rust:1-trixie AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p kaizen-server \
 && cp target/release/kaizen /usr/local/bin/kaizen

# ---- runtime ------------------------------------------------------------------
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home --home-dir /var/lib/kaizen kaizen
COPY --from=server /usr/local/bin/kaizen /usr/local/bin/kaizen
COPY --from=web /web/dist /srv/kaizen/web
ENV KAIZEN_WEB_DIR=/srv/kaizen/web \
    KAIZEN_DATA_DIR=/var/lib/kaizen \
    KAIZEN_LOG_FORMAT=json \
    PORT=8080
USER kaizen
EXPOSE 8080
CMD ["kaizen"]
