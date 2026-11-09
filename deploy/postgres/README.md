# Banco do Capital no Orange Pi

PostgreSQL 17 em Docker, numa stack própria (`capital-db`) separada do app. O `update.sh` do
Capital reconstrói só o app e nunca recria o banco.

No Pi, tudo do Capital fica em `~/capitalapp`:

```text
~/capitalapp/
├── Capital/      repositório do app (git), onde roda o ./update.sh
├── db/           esta pasta: docker-compose.yml, .env (senhas) e scripts
└── data/
    ├── postgres/ arquivos do banco (não mexa com o banco ligado)
    └── backups/  dumps diários e semanais
```

| Container | O que faz |
|---|---|
| `capital-postgres` | Postgres 17 (imagem `postgres:17-alpine`, arm64), fuso `America/Sao_Paulo` |
| `capital-db-backup` | `pg_dump` diário do banco `capital`, com rotação de 7 diários e 4 semanais |
| `capital-db-dev-access` | só com o perfil `dev`: repassa a porta 5432 no IP da Tailscale do Pi |

Bancos e usuários, criados na primeira inicialização por `initdb/01-capital.sh`:

| Banco | Usuário | Uso |
|---|---|---|
| `capital` | `capital` | produção (o app) |
| `capital_dev` | `capital_dev` | desenvolvimento no PC |
| — | `postgres` | superusuário: administração e backup |

Cada usuário só tem permissão de conectar no próprio banco. A porta do Postgres fica publicada
só em `127.0.0.1` no Pi, e a rede de casa não alcança o banco. Com o perfil `dev`, o container
`capital-db-dev-access` repassa a porta **apenas no IP da Tailscale** do Pi. O `pg_hba.conf`
explica por que o controle é feito aí e não por IP de origem.

## Instalação

Copie esta pasta para `~/capitalapp/db` no Pi e rode:

```bash
./install.sh --tailscale   # sem --tailscale, o banco fica acessível só no próprio Pi
```

O script gera um `.env` com senhas aleatórias (se ainda não existir), cria
`~/capitalapp/data/postgres` e `~/capitalapp/data/backups` e sobe os containers. As senhas do
`.env` só valem na primeira inicialização; guarde uma cópia do arquivo.

## Conexões

- **App em produção:** o container do app entra na rede externa `capital-db` e usa
  `DATABASE_URL=postgres://capital:<CAPITAL_DB_PASSWORD>@capital-postgres:5432/capital`.
- **Desenvolvimento no PC (Tailscale):**
  `DATABASE_URL=postgres://capital_dev:<CAPITAL_DEV_DB_PASSWORD>@100.x.y.z:5432/capital_dev`.
  Quando não precisar mais, apague `COMPOSE_PROFILES=dev` do `.env`, rode
  `docker stop capital-db-dev-access && docker rm capital-db-dev-access`, e o banco volta a ser
  acessível só no Pi.
- **Produção a partir do PC** (ex.: migração de dados): por túnel SSH, sem expor nada.
  Rode `ssh -N -L 15432:127.0.0.1:5432 orangepi@100.x.y.z` e use `127.0.0.1:15432`.
- **Administração:** `docker exec -it capital-postgres psql -U postgres -d capital`.

## Backup e restauração

- Os dumps ficam em `~/capitalapp/data/backups/daily` e `weekly` (formato custom do `pg_dump`) e
  são feitos todo dia a partir das 3h. Se o Pi estiver desligado nesse horário, o backup sai assim
  que ele voltar. Para acompanhar: `docker logs capital-db-backup`.
- `backups/config` guarda cópias do `.env.local` do app e do `.env` do banco (atualizadas quando
  mudam). Sem a `ENCRYPTION_KEY`, os dados criptografados de um dump não voltam.
- **A pasta sai do Pi pelo Syncthing:** o container `syncthing` monta `~/capitalapp/data/backups`
  em `/var/capital-backups`, compartilhada como "Backup Capital" (só envio) com o "Servidor".
  No servidor, use "Receber apenas" com versionamento "Lixeira", para os dumps que a rotação
  apaga no Pi continuarem lá.
- Para restaurar, pare o app, rode o script e suba o app de novo:

  ```bash
  docker stop capital
  ./restore.sh ~/capitalapp/data/backups/daily/capital-AAAA-MM-DD.dump
  docker start capital
  ```

## Atualizar a imagem

`docker compose pull && docker compose up -d` atualiza dentro do Postgres 17. Trocar de versão
principal (ex.: 17 → 18) exige dump e restauração; não troque só a tag.
