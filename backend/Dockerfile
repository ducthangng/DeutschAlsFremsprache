# Backend API image. The frontend is deployed separately (Vercel).
#   docker build -t deutschfremsprache-api ./backend
#   docker run -p 8080:8080 --env-file backend/.env deutschfremsprache-api

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server
# Writable data dir for the non-root runtime user (distroless has no shell to chown later).
RUN mkdir -p /out/data

# distroless/static has CA certificates (needed for Azure, OpenAI, S3) and runs as non-root.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /app/server
COPY --from=build --chown=nonroot:nonroot /out/data /data
ENV PORT=8080 \
    DATA_DIR=/data
# DATA_DIR only holds files when S3 is not configured. No volume instruction here
# (Railway rejects it): attach a Railway Volume / docker -v at /data if needed.
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/server"]
