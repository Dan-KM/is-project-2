#!/bin/bash
# Runs once, as the superuser, when the data volume is empty.
# Creates the two login roles using passwords from environment variables.
set -euo pipefail

# -v passes shell variables into psql as psql variables.
# The quoted 'EOSQL' stops the shell from touching the SQL;
# psql substitutes :'name' (as a quoted literal) and :"name" (as an identifier).
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v db_name="$POSTGRES_DB" \
  -v owner_password="$OWNER_DB_PASSWORD" \
  -v app_password="$APP_DB_PASSWORD" <<'EOSQL'

-- Owns the database and schema; used by the Prisma CLI for structure changes
CREATE ROLE system_owner LOGIN PASSWORD :'owner_password';

-- Used by the running Next.js app; gets row-level permissions only (see 02-schema.sql)
CREATE ROLE system_app LOGIN PASSWORD :'app_password';

-- Hand the database to system_owner. On Postgres 15+, the "public" schema
-- belongs to whoever owns the database, so system_owner now controls it too.
ALTER DATABASE :"db_name" OWNER TO system_owner;

-- By default every role may connect to every database. Lock that down,
-- then allow only our app role explicitly.
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO system_app;

EOSQL