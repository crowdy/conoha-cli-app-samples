# syntax=docker/dockerfile:1
FROM node:20-alpine AS web-builder
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:alpine AS go-builder
WORKDIR /src
COPY api/go.mod api/go.sum ./api/
RUN cd api && go mod download
COPY api/ ./api/
COPY --from=web-builder /src/web/out/ ./api/internal/webfs/embed/
RUN cd api && CGO_ENABLED=0 GOOS=linux \
    go build -tags timetzdata -ldflags="-s -w" \
    -o /out/dashboard ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=go-builder /out/dashboard /app/dashboard
RUN mkdir -p /app/data
ENV PORT=8080 \
    DB_PATH=/app/data/dashboard.db
EXPOSE 8080
ENTRYPOINT ["/app/dashboard"]
