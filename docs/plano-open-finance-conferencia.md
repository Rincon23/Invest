# Open Finance vira conferência do mês

Plano de 2026-10-21. **Estado:** C1–C7 feitas no mesmo dia, uma por commit (o que cada uma
entrega está no `README.md`, módulo Open Finance e `lib/server/banks`). Leia antes o `AGENTS.md`, o `docs/prompt-open-finance-pluggy.md` (como o
módulo nasceu, F0–F6) e a seção "Open Finance" do `README.md`. Responda ao dono sempre em
português.

## O que o dono quer (palavras dele, resumidas)

- O Open Finance serve **única e exclusivamente para conferir** o que foi registrado no Capital.
- Ao conectar um banco, **o mês inteiro** já aparece para conferir, e a pessoa vê se está tudo
  congruente naquele mês.
- A conferência mostra **só o mês**: os gastos e os recebimentos do mês, mais as **parcelas que caem
  no mês** (compra de janeiro em 12× aparece em outubro como a parcela 10/12, e o Capital diz se ela
  está lá). Compras à vista e Pix de meses anteriores não são conferidos.
- **Nenhum saldo** em lugar nenhum do app, a não ser na Reserva, quando a pessoa marca uma conta
  como reserva. **Nenhum total de fatura de cartão** no Open Finance (fatura só no módulo Cartão).
- Três conferências: **gastos**, **recebimentos** e **investimentos**.
- Uma lista de **Ignorados** (o que a pessoa ignorou), separada dos **Deixados de fora** (o que o
  app deixa de fora sozinho).
- **Aviso no celular** quando o banco manda a atualização, com a opção de ser **silencioso**.

## Decisões do dono (2026-10-21)

- **Mês:** abre sempre no mês atual; ‹ › (e deslizar, como nos Lançamentos) volta **até o mês
  anterior**, para fechar o fim do mês (o que acontece no dia 31 só chega no dia 1º).
- **Investimentos:** continua **só a quantidade** de ações e cotas no Diagrama (o "Conferir
  investimentos" de hoje). Aplicação e resgate seguem em "Deixados de fora".
- **Aviso:** só quando a atualização trouxe **algo para conferir**. Na engrenagem, "Aviso
  silencioso".

- **Par automático** com o gasto lançado à mão ("✓ Confere" sem toque, C2): aprovado.
- **Cartões:** a conferência diz **quais compras do cartão não foram lançadas** (ou foram lançadas
  fora do cartão), nunca a dívida do cartão. Nenhum total vindo do banco (fatura, em aberto,
  limite) aparece em lugar nenhum; no módulo Cartão, a fatura continua sendo só a do Capital (C4).

## Como está hoje (o que muda)

- `BanksScreen.tsx` e `BanksHomeCard.tsx` mostram "Saldo nas contas" (`accountsBalance`); cada
  conta mostra o saldo, e cada cartão o "em aberto" e o vencimento.
- `reviewTransactions()` (`lib/server/banks/repository.ts`) pega o que não foi decidido **desde 7
  dias antes de o banco ser conectado**: o começo do mês nunca aparece.
- Gastos e recebimentos ficam numa lista só (`BankReviewScreen.tsx`).
- Uma parcela de compra que já está no Capital vai para "Deixados de fora" (`in_plan`), em vez de
  "✓ confere".
- **Parcelas nos dados reais** (banco de dev, 98 parcelas): há bancos que mandam **uma parcela por
  mês**, com a data da fatura (5/10 de uma compra de 12/06 chega com 02/10), e bancos que mandam
  **todas de uma vez**, com a data do dia seguinte à compra (as 10 parcelas de uma compra de 10/05
  vêm com 11/05). Pela data, a parcela do mês do segundo tipo nunca aparece.
- "Ignorar" grava `outcome = 'ignored'` e o item some sem volta; "Tirar da lista" dos Deixados de
  fora faz o mesmo.
- O aviso (`lib/banks/alerts.ts`) resume compras e Pix por banco, com switches por tipo e valor
  mínimo; sempre toca (`renotify` no `public/sw.js`), sem opção silenciosa.

## Fases

Uma por commit, cada uma boa sozinha. Teste no navegador (375×812, claro e escuro) e mostre ao
dono antes de cada commit.

### C1 — Sem saldo e sem fatura fora da Reserva

1. `BanksScreen.tsx`: sai o "Saldo nas contas". O cartão do topo vira o ponto de partida da
   conferência: "Buscar novidades" e os botões "Conferir gastos", "Conferir recebimentos" (cada
   um com quantos faltam no mês atual, quando a C2 existir) e "Conferir investimentos" (com o
   Diagrama ligado, como hoje).
2. `AccountRow`: só o nome e o tipo ("conta", "poupança", "cartão"), sem valor e sem vencimento.
3. `BanksHomeCard.tsx`: sai o saldo; fica a lista dos bancos com "atualizado há…" (e, depois da
   C2, "N para conferir em outubro").
4. O overview (`GET /api/v1/banks`, tipo `BankAccount`) **para de mandar** saldo, limite,
   disponível e vencimento ao navegador. Os saldos continuam guardados no servidor só para a
   Reserva (`/api/v1/banks/reserve`, que segue mostrando os valores para a pessoa marcar).
5. Tire `accountsBalance` (e o teste) se não sobrar uso. Ajuste o tour (`lib/modules/tours.ts`),
   o README e a página `app/privacidade` ("o saldo só aparece na Reserva, nas contas que você
   marcar").

### C2 — A conferência é do mês

Servidor (`lib/server/banks/review.ts`, `repository.ts`; lógica pura em `lib/banks/review.ts`):

1. `buildReview(month)` (padrão: o mês atual em `zonedToday()`; só aceita o atual e o anterior).
2. **O que entra no mês:**
   - transações de conta (Pix, débito, boleto, salário…) com `date` no mês;
   - compras à vista no cartão com `date` no mês;
   - **compras parceladas com parcela no mês**: agrupe como hoje (`groupInstallments`) com
     **todas** as transações da compra, de qualquer data, e calcule a parcela do mês por
     `mês da compra + (n − 1)`, com `1 ≤ n ≤ total`. Isso vale para os dois jeitos de os bancos
     mandarem. Quando a compra está no Capital (`matchingPlan`), mostre o número da parcela do
     Capital (o plano sabe a primeira cobrança pelo fechamento do cartão).
   - sai o filtro "desde a conexão − 7 dias": a primeira leitura já traz um ano, então o mês
     inteiro aparece ao conectar.
3. **Cada linha cai em um destes grupos:**
   - **Falta no Capital**: o que pede um toque (Lançar, lápis, Ignorar, como hoje; parcelado sem
     plano → "Conferir parcelado", com as parcelas já pagas);
   - **✓ Confere**: já está no Capital — `outcome` de lançado/ligado/recebido/fatura, compra
     parcelada que bate com um plano (nada gravado: é calculado a cada leitura), e o **par forte**
     com um lançamento manual: mesmo valor ao centavo, até 1 dia de diferença, mesmo cartão quando
     os dois dizem, e um candidato só. O par forte aparece como "✓ Confere com 'Mercado' de
     12/10", com "Não é este" (volta a "Falta no Capital"). Par fraco (até 2 dias, ou mais de um
     candidato) continua com "Parece que você já lançou isso: É o mesmo / É outro";
   - **Deixados de fora**: os motivos de hoje (fatura, entre contas suas, investimento, estorno),
     sem `in_plan` (agora é "✓ Confere"). Eles **não pedem nada**: saem "Tirar da lista" e
     "Tirar todos da lista"; ficam "Lançar mesmo assim" e "Marcar a fatura como paga?";
   - **Ignorados**: `outcome = 'ignored'` (C4).
4. A resposta separa **gastos** (dinheiro saindo e compras no cartão) e **recebimentos** (dinheiro
   entrando na conta; o estorno do cartão continua em Deixados de fora dos gastos), com a
   contagem do que falta de cada um. O A receber (F6) fica nos recebimentos.
5. Uma rota leve só com as contagens do mês atual, para a tela dos bancos e a Início.
6. Testes: os dois jeitos de parcela (gravados do formato real acima), virada de mês, par forte ×
   fraco, compra parcelada que bate com plano, mês anterior aceito e mês mais antigo recusado.

### C3 — Telas "Conferir gastos" e "Conferir recebimentos"

1. `/bancos/conferir?tipo=gastos|recebimentos`, com abas "Gastos" e "Recebimentos" e o mês no
   topo, com ‹ › e deslizar (só entre o mês atual e o anterior).
2. Em cada aba: "Falta no Capital (N)" aberto; "✓ Confere (N)", "Deixados de fora (N)" e
   "Ignorados (N)" fechados, cada um com a contagem.
3. Tudo conferido: "Outubro confere ✓".
4. Os botões da tela dos bancos (C1) abrem cada aba; o aviso (C6) abre a aba que tem mais coisa.

### C4 — Conferir os cartões: o que não foi lançado

O que a pessoa quer saber do cartão é **qual compra ficou de fora do Capital**, não quanto ela deve.
Nada aqui soma valores do banco: cada linha mostra o valor daquela compra, e cada cartão mostra só
contagens ("2 faltam · 14 conferem").

1. **Na aba Gastos, um bloco por origem:** cada cartão do Capital ligado a um cartão do banco
   ("Nubank Mastercard"), depois "Conta (Pix e débito)". Cada bloco tem as mesmas seções da C3
   (Falta no Capital, ✓ Confere, Deixados de fora, Ignorados), com a contagem no título e sem
   total em reais.
2. **Cartão do banco sem ligação:** a pergunta de hoje ("Qual é cada cartão no Capital?") fica no
   topo do bloco dele e aparece mesmo sem compra a lançar, porque sem ela o Capital não sabe em
   que cartão conferir. "Não informar" continua valendo (as compras conferem com o "Não
   informado").
3. **O que entra no bloco de um cartão no mês:**
   - compras à vista com data no mês;
   - a parcela do mês de cada compra parcelada (regra da C2). Quando a compra já está no Capital,
     vale o mês do próprio Capital: a parcela cuja cobrança (`installmentDueDates`) cai no mês,
     como a fatura do Cartão já conta;
   - estorno e pagamento de fatura continuam em Deixados de fora. "Marcar a fatura como paga?"
     continua comparando com a fatura **do Capital**, nunca mostrando a do banco.
4. **O que a comparação reconhece** (com a data da compra: `purchaseDate` quando houver, senão
   `date`):
   - **✓ Confere:** o gasto está no Capital nesse cartão (par forte ou "É o mesmo"), ou a compra
     parcelada bate com um plano desse cartão;
   - **Lançado fora do cartão:** o par existe, mas no Capital está sem cartão, como "Não
     informado" ou em outro cartão. A linha diz onde está ("Está como Pix/débito", "Está no
     Amazon") e oferece **"Pôr no Nubank"**, que salva pela mesma função do formulário
     (`saveExpense`, com `cardId` e `singleInstallmentCard`). Um mês fechado recusa, como no
     formulário;
   - **Lançado à vista, no banco é parcelado:** no Capital há um gasto com o valor total, e no
     banco são 10× de R$ 87. A linha avisa e abre o formulário de compra parcelada já preenchido.
     Nada é trocado sozinho;
   - **Falta no Capital:** nada parecido. "Lançar" já vem com o cartão ligado (como hoje).
5. **Atalho no módulo Cartão** (só com o Open Finance ligado e conta VIP): na aba Fatura de cada
   mês, uma linha por cartão ligado, "2 compras do banco não estão aqui · Conferir", que abre a
   aba Gastos nesse mês e nesse cartão. Quando tudo confere, a linha é "✓ Confere com o banco".
   Não mostra nenhum valor do banco.
6. **Testes:** compra lançada à mão sem cartão, compra em outro cartão, compra lançada à vista que
   no banco é parcelada, cartão sem ligação, "Não informar", e a garantia de que nenhuma resposta
   da API leva total de fatura, saldo ou limite do banco.

### C5 — Lista de Ignorados

1. "Ignorar" continua gravando `outcome = 'ignored'`; o item vai para "Ignorados", com
   **"Voltar para conferir"** (ação nova `restore` em `applyReviewAction`, que só aceita
   `ignored` e volta `outcome` para null).
2. O que já foi tirado dos Deixados de fora antes desta mudança também tem `ignored`: aparece em
   Ignorados com o motivo, e não há migração.

### C6 — Aviso quando o banco atualiza, com opção silenciosa

1. Depois de cada leitura com novidade (não a primeira, porque a pessoa está na tela), o resumo
   conta só o que é **novo nesta leitura e caiu em "Falta no Capital"** no mês atual ou no
   anterior: "🏦 Nubank atualizou: 3 gastos e 1 recebimento para conferir." Sem nada para
   conferir, não avisa. Use o mesmo `buildReview` para contar, para o aviso nunca discordar da
   tela. `sourceKey` como hoje.
2. Engrenagem: "Gastos para conferir", "Recebimentos para conferir" e **"Aviso silencioso"**
   (chega na central e na bandeja do celular, sem som nem vibração). Os switches antigos
   (`purchases`, `pixSent`, `pixReceived`) e o valor mínimo saem; `alertSettingsOf` converte o
   que estava salvo (gastos = compras ou Pix enviados; recebimentos = Pix recebidos).
3. `PushMessage` ganha `silent?: boolean`; o `public/sw.js` passa `silent` ao `showNotification`
   e não usa `renotify` quando é silencioso. Suba o `CACHE_VERSION`. Um service worker antigo
   ignora o campo (toca): tudo bem.
4. Os avisos de banco parado e de autorização vencendo continuam iguais, e também respeitam o
   silencioso.

### C7 — Fechamento

README (módulo e técnico), tour, privacidade, `npx vitest run --exclude ".claude/**" --exclude
"node_modules/**"` e `npm run lint`. Push e deploy só quando o dono pedir.

## Regras que valem aqui

- Nada entra nos Lançamentos sem um toque, e nenhuma fatura sai sozinha.
- Nenhum total vindo do banco (saldo, fatura, em aberto, limite) chega à tela, a não ser os saldos
  das contas que a pessoa marca para a Reserva.
- O par forte e o plano batendo são **calculados**, nunca gravados como decisão: "Não é este"
  desfaz sem apagar nada.
- Nada dos costumes do dono: nenhum banco tem papel fixo.
- Texto curto: uma linha de ajuda por tela; o resto atrás de ⓘ. Nunca "agora" ou "em tempo
  real" nos avisos.
