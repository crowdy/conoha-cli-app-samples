# Auth Data Model

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : has
    USERS {
        uuid id PK
        string email
        string password_hash
    }
    SESSIONS {
        uuid id PK
        uuid user_id FK
        uuid tenant_id
        timestamp expires_at
    }
```

## Tables

### users

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| email | text | unique within tenant |
| password_hash | text | argon2id |

### sessions

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | references users.id |
| tenant_id | uuid | references tenants.id |
| expires_at | timestamptz | session expiry |
