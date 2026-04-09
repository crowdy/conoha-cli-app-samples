# Stage 1: Build
FROM rust:1.94-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Production runner
FROM alpine:3.21
WORKDIR /app
COPY --from=builder /app/target/release/conoha-rust-sample ./server
EXPOSE 3000
CMD ["./server"]
