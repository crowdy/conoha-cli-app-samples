# Demo Spec Fixture

A small spec-as-code repository demonstrating the doc-reviewer in action.

This fixture intentionally contains issues so the reviewer surfaces findings:

- `domains/auth/flows/login.md` — TBD marker
- `domains/auth/screens/login.md` — empty section
- `domains/checkout/flows/purchase.md` — broken internal link
- `domains/checkout/api.yml` — error code missing from glossary (deep mode only)
- `domains/auth/data-model.md` — ADR-0001 violation: users table missing tenant_id (deep mode only)

## Layout

- `glossary.md` — domain terminology (single source of truth)
- `adr/` — Architecture Decision Records
- `domains/<name>/` — feature-scoped specs (api, flows, screens, data model)
