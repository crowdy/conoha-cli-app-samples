#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${PARENT_ZONE:?PARENT_ZONE must be set}"
: "${PRIMARY_NS:?PRIMARY_NS must be set}"
: "${SOA_EMAIL:?SOA_EMAIL must be set}"

echo "[pdns-init] applying schema"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /schema.pgsql.sql >/dev/null

echo "[pdns-init] seeding zone $PARENT_ZONE"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO domains (name, type) VALUES ('${PARENT_ZONE}', 'NATIVE')
  ON CONFLICT (name) DO NOTHING;

INSERT INTO records (domain_id, name, type, content, ttl, auth, disabled)
  SELECT id, '${PARENT_ZONE}', 'SOA',
         '${PRIMARY_NS} ${SOA_EMAIL} 1 10800 3600 604800 3600',
         3600, true, false
  FROM domains WHERE name = '${PARENT_ZONE}'
    AND NOT EXISTS (
      SELECT 1 FROM records r2
      WHERE r2.name = '${PARENT_ZONE}' AND r2.type = 'SOA'
    );

INSERT INTO records (domain_id, name, type, content, ttl, auth, disabled)
  SELECT id, '${PARENT_ZONE}', 'NS', '${PRIMARY_NS}',
         3600, true, false
  FROM domains WHERE name = '${PARENT_ZONE}'
    AND NOT EXISTS (
      SELECT 1 FROM records r2
      WHERE r2.name = '${PARENT_ZONE}' AND r2.type = 'NS'
        AND r2.content = '${PRIMARY_NS}'
    );
SQL

# Token seed: only if no token exists yet (idempotent across restarts)
EXISTING=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM app.api_tokens")
if [ "$EXISTING" -eq 0 ]; then
  TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 32)}"
  HASH=$(python3 -c "import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt()).decode())" "$TOKEN")
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO app.api_tokens (token_hash, label) VALUES ('$HASH', 'admin');" >/dev/null
  echo "============================================"
  echo "ADMIN_TOKEN=$TOKEN"
  echo "(this line is printed only on first boot)"
  echo "============================================"
else
  echo "[pdns-init] api_tokens already populated, skipping token seed"
fi

echo "[pdns-init] done"
