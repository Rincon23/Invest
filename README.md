# Invest +

PWA de investimentos (Next.js 16 + Postgres no Orange Pi), irmão do **Capital +**. O Capital +
cuida dos gastos; o Invest + cuida da carteira. Nasceu do Capital + em 2026-11-09 (commit `b4c3076`
de `Rincon23/Capital`) e tem a mesma cara: a Início em telas de widgets, a gaveta de apps pela
setinha, o "?" com o tour de cada módulo, Configurações, Notificações e Administração.

Leia o `AGENTS.md` e os guias em `node_modules/next/dist/docs/` antes de mexer no código.

## Módulos

| Módulo | O que faz |
|---|---|
| **Diagrama** | Quanto aportar em cada ativo: tipos e metas, ativos com notas (−10 a 10) e perguntas por tipo, renda fixa sem cotação, "Aportar" e o histórico de aportes. Tudo em R$ (dólar e cripto convertidos). Graham e P/VP automáticos só para quem tem acesso aos restritos. |
| **Histórico** | A carteira de hoje aos preços de cada dia (1M, 6M, 1A, 5A), por tipo e por ativo. Não guarda rentabilidade. |
| **Open Finance** | Só para **conferir os investimentos**: a pessoa liga a própria chave do Meu Pluggy, traz as corretoras, e o "Conferir investimentos" compara, ativo por ativo, a quantidade da corretora com a do Diagrama. Restrito por padrão. |

Não tem missões, XP, gastos, cartão, reserva nem lembretes: isso é do Capital +.

### Fora do Diagrama

O que a corretora tem e não é do Diagrama (a Reserva investida do Capital +, uma posição à parte)
fica marcado como **"Fora do Diagrama"**, por ticker, e sai da conferência:

- num ativo que só a corretora tem: **Fora do Diagrama** (tudo dele fica fora);
- num ativo que os dois têm e a corretora tem mais: **Deixar N fora** (a diferença fica fora);
- **Voltar a conferir** desfaz.

A marca é por ticker (`diagram_outside`), então sobrevive a trazer a corretora de novo, e vai no backup.

## Um serviço de cotações para os dois apps

Para não pesar o Pi, só o Invest + fala com a B3 e o Yahoo. O Capital + pergunta a ele o preço da
Reserva investida em `POST http://invest:3000/api/internal/quotes` (rede Docker `capital-db`), com
`Authorization: Bearer <QUOTES_SERVICE_TOKEN>` e o corpo `{ "tickers": ["AUPO11"] }`. A resposta sai
do cache (`price_cache`) quando o preço tem menos de 15 minutos; só o que está velho vai à B3/Yahoo.

- O segredo `QUOTES_SERVICE_TOKEN` é o mesmo nos dois `.env.local`; sem ele o serviço não responde.
- Qualquer pedido que chegou pelo túnel da Cloudflare (tem `cf-connecting-ip`) recebe 404.
- Código: `lib/server/quoteService.ts` e `app/api/internal/quotes/route.ts`.

## Como rodar (desenvolvimento)

```bash
npm install
cp .env.example .env.local   # DATABASE_URL do invest_dev, segredos novos
npm run dev -- --port 3001
```

A porta 3001 deixa o Capital + rodar ao lado, na 3000 (o Capital + de desenvolvimento pergunta as
cotações a `http://localhost:3001`). Testes: `npm test -- --maxWorkers=4`.

## Banco de dados

O Invest + usa o **mesmo Postgres do Capital +** no Pi (`capital-postgres`, a stack de
`deploy/postgres` do repositório Capital), com **bancos próprios**: `invest` (produção) e
`invest_dev`, cada um com o seu usuário, que só conecta no próprio banco. O backup diário daquela
stack salva os dois. As migrações (`drizzle/`) começam do zero (`0000_init.sql`) e rodam sozinhas
quando o servidor sobe.

## Publicar no Orange Pi

No Pi, o Invest + fica junto do Capital +: o repositório em `~/capitalapp/Invest`, os logs em
`~/capitalapp/logs` e o banco em `~/capitalapp/db` (o backup diário já leva o `.env.local` dele).

1. **Bancos `invest` e `invest_dev`** (uma vez): em `~/capitalapp/db`, rode `./add-invest.sh`
   (do repositório Capital). Ele cria os usuários e bancos e põe as senhas no `.env` de lá.
2. **App:**

   ```bash
   cd ~/capitalapp/Invest
   cp .env.example .env.local
   # DATABASE_URL=postgres://invest:<INVEST_DB_PASSWORD>@capital-postgres:5432/invest
   # BETTER_AUTH_SECRET, VAPID_*, ENCRYPTION_KEY: novos, só do Invest +
   # BETTER_AUTH_URL=https://invest.rincon.dev.br  e  APP_ALLOWED_ORIGINS=invest.rincon.dev.br
   # QUOTES_SERVICE_TOKEN: o mesmo do Capital +
   ./update.sh
   ```

3. **Endereço:** no túnel da Cloudflare, `invest.rincon.dev.br` → `http://localhost:3001`.

O container se chama `invest`, publica a porta 3001 só em `127.0.0.1` e entra na rede `capital-db`.
Atualizar depois: `./update.sh`. O build leva mais de 10 minutos no Pi: não rode o do Capital + ao
mesmo tempo.

## Trazer o Diagrama do Capital + (uma vez)

`scripts/migrate-from-capital.mjs` copia, de quem usa o Diagrama no Capital +: a conta (mesmo id,
e-mail e senha), o acesso aos restritos, o Diagrama inteiro, a chave da Pluggy (cifrada de novo com
a `ENCRYPTION_KEY` do Invest +) e as cotas da Reserva investida como "Fora do Diagrama". Só **lê** o
banco do Capital +; conta que já existe no Invest + é pulada. Sem `--apply` é só um ensaio.

```bash
docker exec -e CAPITAL_DATABASE_URL='postgres://capital:...@capital-postgres:5432/capital' \
  -e CAPITAL_ENCRYPTION_KEY='...' invest node scripts/migrate-from-capital.mjs
docker exec -e CAPITAL_DATABASE_URL='...' -e CAPITAL_ENCRYPTION_KEY='...' invest \
  node scripts/migrate-from-capital.mjs --apply
```

### As corretoras: as mesmas conexões do Capital +

Desde 2026-11 o plano grátis da Pluggy só cria conexões pelo Connect Widget dela; criar pela API
(o que o "Trazer um banco" fazia) responde `CREATE_ITEMS_API_FREE_DISABLED`, e o app mostra isso com
uma mensagem clara. Como a chave da Pluggy é a mesma nos dois apps, o Invest + **usa as conexões que a
pessoa já tem no Capital +**: `scripts/copy-connections-from-capital.mjs` copia os ids das conexões que
mandaram investimentos (e os investimentos da última leitura), só para quem tem a mesma chave nos dois.
Sem `--apply` é um ensaio:

```bash
docker exec -e CAPITAL_DATABASE_URL='postgres://capital:...@capital-postgres:5432/capital'   invest node scripts/copy-connections-from-capital.mjs --apply
```

Por serem compartilhadas, **"Tirar banco" e "Desconectar" no Invest + nunca apagam a conexão na
Pluggy**: ela só sai daqui e continua no Meu Pluggy e no Capital +.

## Testes automáticos (Administração)

Como no Capital +: `lib/server/selfTest` roda os testes de cada módulo dentro do servidor (alguns
minutos depois de subir e de hora em hora) e avisa o dono quando um passa a falhar. Um módulo novo
não compila sem os seus testes em `SELF_CHECKS`.
