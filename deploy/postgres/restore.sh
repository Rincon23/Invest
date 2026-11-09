#!/bin/sh
# Restaura um dump do Capital gerado pelo backup.sh. Rode no Orange Pi, nesta pasta:
#
#   ./restore.sh /home/orangepi/capitalapp/data/backups/daily/capital-2026-09-15.dump [banco]
#
# ATENÇÃO: substitui o conteúdo atual do banco (padrão: "capital"). Pare o app antes
# (docker stop capital) e ligue de novo depois (docker start capital).
set -eu

file="${1:?informe o arquivo .dump}"
db="${2:-capital}"
[ -f "$file" ] || { echo "Arquivo não encontrado: $file" >&2; exit 1; }

printf 'Isso substitui o banco "%s" pelo conteúdo de %s. Continuar? [s/N] ' "$db" "$file"
read -r answer
case "$answer" in
  s | S) ;;
  *) echo "Cancelado. Nada foi alterado."; exit 1 ;;
esac

# --no-owner + --role=capital: tudo restaurado fica com o dono de sempre (o usuário do app).
docker exec -i capital-postgres \
  pg_restore --username=postgres --dbname="$db" --clean --if-exists --no-owner --role=capital \
  < "$file"
echo "Banco \"$db\" restaurado de $file."
