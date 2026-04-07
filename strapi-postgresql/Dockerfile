FROM node:20-alpine

RUN apk add --no-cache build-base python3

WORKDIR /app

# Create Strapi project non-interactively (pipe yes to skip cloud login prompt)
ENV STRAPI_DISABLE_REMOTE_DATA_TRANSFER=true
RUN echo "n" | npx --yes create-strapi-app@4.25.9 . \
  --no-run \
  --dbclient postgres \
  --dbhost db \
  --dbport 5432 \
  --dbname strapi \
  --dbusername strapi \
  --dbpassword strapi \
  --dbssl false \
  || true

# Verify package.json exists (project was created)
RUN test -f /app/package.json

# Install pg driver
RUN npm install pg

EXPOSE 1337
CMD ["npm", "run", "develop"]
