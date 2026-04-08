#!/bin/bash
set -e

# Create the dex database and grant privileges
# (The gitea database is created automatically via POSTGRES_DB)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE ${DEX_DB_NAME:-dex};
    CREATE USER ${DEX_DB_USER:-dex} WITH PASSWORD '${DEX_DB_PASSWORD:-dex}';
    GRANT ALL PRIVILEGES ON DATABASE ${DEX_DB_NAME:-dex} TO ${DEX_DB_USER:-dex};
    ALTER DATABASE ${DEX_DB_NAME:-dex} OWNER TO ${DEX_DB_USER:-dex};
EOSQL
