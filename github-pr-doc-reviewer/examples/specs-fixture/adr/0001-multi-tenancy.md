# ADR-0001: Multi-tenancy via tenant_id columns

## Status

Accepted, 2026-01-15.

## Context

We serve multiple customer organizations from a single database. Logical isolation must prevent any cross-tenant data leakage.

## Decision

Every persistent table that holds tenant-scoped data MUST include a `tenant_id` column (UUID, NOT NULL). All queries MUST filter by `tenant_id`. The application layer enforces this via a global query scope.

## Consequences

- Schema simpler than per-tenant database/schema isolation.
- Application bugs that bypass the scope are catastrophic — code review must catch these.
- Indexes on tenant-scoped tables MUST lead with `(tenant_id, ...)`.
