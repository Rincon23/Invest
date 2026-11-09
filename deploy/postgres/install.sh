#!/bin/sh
# Instala (ou reinstala) o banco do Capital neste Pi. Pode rodar de novo sem medo: não
# sobrescreve um .env existente nem mexe em dados já criados.
#
#   ./install.sh               banco acessível só no próprio Pi
#   ./install.sh --tailscale   também libera o banco de dev pela Tailscale (desenvolvimento no PC)
#
# A opção --tailscale só vale ao criar o .env; depois, edite COMPOSE_PROFILES/DEV_ACCESS_ADDR
# no .env e rode `docker compose up -d`.
set -eu
cd "$(dirname "$0")"

DATA_ROOT="${CAPITAL_DATA_ROOT:-$HOME/capitalapp/data}"
DEV_ACCESS=""
if [ "${1:-}" = "--tailscale" ]; then
  TS_IP=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
  if [ -z "$TS_IP" ]; then
    echo "Não achei o IP da Tailscale (tailscale ip -4). Rode sem --tailscale." >&2
    exit 1
  fi
  DEV_ACCESS="COMPOSE_PROFILES=dev
DEV_ACCESS_ADDR=$TS_IP:5432"
fi

# O Postgres roda como outro usuário (uid 70) dentro do container: initdb/ e pg_hba.conf
# precisam ser legíveis por ele, senão o banco nem inicializa.
chmod 755 ./*.sh ./initdb ./initdb/*.sh
chmod 644 ./pg_hba.conf
mkdir -p "$DATA_ROOT/postgres" "$DATA_ROOT/backups"
chmod 700 "$DATA_ROOT" "$DATA_ROOT/backups"

if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
CAPITAL_DB_PASSWORD=$(openssl rand -hex 24)
CAPITAL_DEV_DB_PASSWORD=$(openssl rand -hex 24)
DATA_DIR=$DATA_ROOT/postgres
BACKUP_DIR=$DATA_ROOT/backups
BACKUP_HOUR=3
BACKUP_UID=$(id -u)
BACKUP_GID=$(id -g)
$DEV_ACCESS
EOF
  echo "==> .env criado com senhas aleatórias. Guarde uma cópia dele num lugar seguro."
else
  echo "==> .env já existe; mantido como está."
fi

echo "==> baixando as imagens"
for try in 1 2 3; do
  if docker compose pull --quiet; then break; fi
  if [ "$try" = 3 ]; then
    echo "Não foi possível baixar as imagens. Verifique a internet do Pi e rode de novo." >&2
    exit 1
  fi
  echo "    falhou (tentativa $try de 3); tentando de novo em 10 s"
  sleep 10
done

echo "==> subindo a stack capital-db"
docker compose up -d --wait --wait-timeout 180
docker compose ps
