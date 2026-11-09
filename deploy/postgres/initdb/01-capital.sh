#!/bin/sh
# Roda uma única vez, na primeira inicialização do Postgres (pasta de dados vazia). Cria:
#   - usuário "capital",     dono do banco "capital"      (produção)
#   - usuário "capital_dev", dono do banco "capital_dev"  (desenvolvimento), se houver senha
# Cada usuário só consegue conectar no próprio banco.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v pw="$CAPITAL_DB_PASSWORD" <<'SQL'
CREATE ROLE capital LOGIN PASSWORD :'pw';
CREATE DATABASE capital OWNER capital;
REVOKE CONNECT ON DATABASE capital FROM PUBLIC;
GRANT CONNECT ON DATABASE capital TO capital;
SQL

if [ -n "${CAPITAL_DEV_DB_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v pw="$CAPITAL_DEV_DB_PASSWORD" <<'SQL'
CREATE ROLE capital_dev LOGIN PASSWORD :'pw';
CREATE DATABASE capital_dev OWNER capital_dev;
REVOKE CONNECT ON DATABASE capital_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE capital_dev TO capital_dev;
SQL
fi
