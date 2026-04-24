FROM node:20-alpine

RUN apk add --no-cache build-base python3

WORKDIR /app

# Skip the Strapi Cloud login prompt that otherwise hangs headless
# deploys on the arrow-key "Login/Sign up | Skip" menu.
ENV STRAPI_DISABLE_REMOTE_DATA_TRANSFER=true
ENV STRAPI_TELEMETRY_DISABLED=true

RUN npx --yes create-strapi-app@4.25.9 . \
  --no-run \
  --skip-cloud \
  --dbclient postgres \
  --dbhost db \
  --dbport 5432 \
  --dbname strapi \
  --dbusername strapi \
  --dbpassword strapi \
  --dbssl false

RUN test -f /app/package.json

RUN npm install pg

EXPOSE 1337
CMD ["npm", "run", "develop"]
