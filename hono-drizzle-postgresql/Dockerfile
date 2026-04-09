FROM node:22-alpine
WORKDIR /app
COPY package.json ./
# tsx is in dependencies (not devDependencies), so --omit=dev keeps it.
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
