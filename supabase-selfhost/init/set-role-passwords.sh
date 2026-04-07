#!/bin/bash
set -e

# Set passwords for Supabase internal roles that the image creates without passwords.
# During docker-entrypoint init, connect via local socket as supabase_admin (superuser).
# PGPASSWORD must be set explicitly because the Supabase pg_hba.conf requires
# scram-sha-256 for supabase_admin even on local connections.
export PGPASSWORD="${POSTGRES_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username supabase_admin --dbname "${POSTGRES_DB:-postgres}" <<-EOSQL
    ALTER ROLE supabase_auth_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
    ALTER ROLE authenticator WITH PASSWORD '${POSTGRES_PASSWORD}';
    ALTER ROLE supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
EOSQL
