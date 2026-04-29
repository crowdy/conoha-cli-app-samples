# Glossary

| Term | Definition |
|---|---|
| Tenant | A customer organization. All persistent data is partitioned by tenant. |
| User | An individual end-user belonging to exactly one tenant. |
| Session | An authenticated period for a user. Implemented as a short-lived JWT. |
| Order | A confirmed purchase of one or more items by a user within a tenant. |

## Error codes

| Code | Domain | Meaning |
|---|---|---|
| E_AUTH_01 | auth | Invalid credentials |
| E_AUTH_02 | auth | Session expired |
| E_PAY_01 | checkout | Card declined |
| E_PAY_02 | checkout | Insufficient funds |
