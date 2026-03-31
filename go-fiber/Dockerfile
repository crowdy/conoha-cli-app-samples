# Stage 1: Build
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server .

# Stage 2: Production runner
FROM alpine:3.21
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE 3000
CMD ["./server"]
