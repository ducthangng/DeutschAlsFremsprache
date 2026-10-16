# Production image: the Go server serving the API and the built frontend.
#   docker build -t deutschfremsprache .
#   docker run -p 8080:8080 --env-file backend/.env -e DATABASE_URL=... deutschfremsprache

# ---- frontend ----
FROM node:22.12-alpine AS web
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend ----
FROM golang:1.26-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- runtime ----
# distroless/static has CA certificates (needed for Azure, OpenAI, S3) and runs as non-root.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=api /out/server /app/server
COPY --from=web /src/dist /app/web
ENV PORT=8080 \
    STATIC_DIR=/app/web \
    DATA_DIR=/data
# DATA_DIR only holds files when S3 is not configured; mount a volume there in that case.
VOLUME ["/data"]
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/server"]
