FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY . .
RUN mkdir -p /data
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
