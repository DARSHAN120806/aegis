#!/bin/sh
set -eu
# Values passed through psql variables; SQL quotes are not built in the shell.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_password="$AEGIS_DB_PASSWORD" <<'SQL'
CREATE ROLE aegis_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE aegis TO aegis_app;
GRANT USAGE ON SCHEMA public TO aegis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aegis_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE ON TABLES TO aegis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aegis_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO aegis_app;
SQL
