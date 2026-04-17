# Vendored LINE OpenAPI Specs

Source: https://github.com/line/line-openapi
Commit: 779d8ca9e632452ceb4e387b59b7f993497f051c
Downloaded: 2026-04-17

## Files

| File | Source path in upstream |
|------|-------------------------|
| messaging-api.yml | messaging-api.yml |

## Refreshing

```bash
curl -L -o specs/messaging-api.yml \
  https://raw.githubusercontent.com/line/line-openapi/main/messaging-api.yml
npm run gen:types
```

Keep the commit SHA in this file up to date.
