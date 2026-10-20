#!/usr/bin/env bash
# SOCC local development bootstrap.
# Runs only when the (SOCC-owned) data volume is first created.
# Creates the least-privilege application role used at runtime so that
# PostgreSQL Row-Level Security is actually enforced (the table owner
# would otherwise bypass RLS).

set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'socc_app') THEN
    CREATE ROLE socc_app LOGIN PASSWORD '${SOC_APP_DB_PASSWORD}';
  END IF;
END
\$\$;
EOSQL
