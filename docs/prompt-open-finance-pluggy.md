# Open Finance no Capital pelo Meu Pluggy (módulo VIP)

## Contexto

Capital é um PWA mobile-first de orçamento por categorias (Next.js 16 + Postgres no Orange Pi, usado
pelo dono e por amigos; leia o `AGENTS.md` e os guias em `node_modules/next/dist/docs/` antes de
escrever código). Tudo é módulo (`lib/modules/catalog.ts`), a Início é um launcher estilo celular e
a ajuda de cada módulo é um tour do driver.js (`lib/modules/tours.ts`). O `README.md` descreve o
comportamento atual em detalhe. Responda ao dono sempre em português.

O dono quer conectar os bancos pelo Open Finance para três coisas:

1. **Avisar no celular** quando a pessoa fizer uma compra no cartão ou um Pix.
2. **Avisar** quando ela receber um Pix ou o salário.
3. **Usar contas conectadas como reserva de emergência**: a Reserva passa a se atualizar sozinha
   pelo saldo das contas que **a própria pessoa** escolher, de qualquer banco.

**O dono é só um dos usuários.** Os costumes dele não entram no app: ele usa a Caixa como reserva,
mas outra pessoa pode usar o BTG como reserva e a Caixa como conta do dia a dia. Nenhum banco tem
papel fixo; tudo é escolha de cada pessoa e editável a qualquer hora.

## Por que Meu Pluggy (pesquisa feita em 2026-10-20)

- Ser participante direto do Open Finance exige ser instituição autorizada pelo Banco Central:
  inviável. Agregadores pagos (Pluggy, Belvo, Tecnospeed) custam de ~R$ 540 a ~R$ 6.000/mês.
- O **Meu Pluggy** (https://www.pluggy.ai/meu-pluggy) é grátis e sem prazo para **uso pessoal**:
  a pessoa conecta os próprios bancos em meu.pluggy.ai e um app lê os dados pela API da Pluggy com
  um **Client ID e Client Secret dela mesma**, criados em dashboard.pluggy.ai.
- Limites conhecidos: **até 5 conexões ativas, do mesmo titular**; contas de terceiros e uso
  comercial exigem plano pago. Os dados chegam **uma vez por dia** (a Pluggy sincroniza a cada
  ~24 h) e o app **não consegue forçar** uma atualização. O acesso é **só de leitura**.
- Os dados vêm num formato único para todos os bancos (o Open Finance padroniza e a Pluggy
  normaliza): **não existe código por banco**. Mas vários campos são opcionais e cada banco
  preenche o que quer.

## Decisões do dono que NÃO mudam

- **Meu Pluggy, grátis.** Cada pessoa conecta **a própria** Pluggy, com as próprias credenciais.
  O servidor não tem chave da Pluggy no `.env.local`.
- **Módulo VIP** (`vipOnly: true`): o dono quer ver como fica antes de abrir para todos. Quem não
  é VIP vê o selo "VIP" (nunca "Em breve"), como em "Lançar por voz ou texto".
- **Tudo pelo app.** O Capital guia passo a passo e, quando precisa, **abre o site da Pluggy** no
  ponto certo e traz a pessoa de volta. Fora do app ficam só o que não tem como evitar: criar a
  conta na Pluggy, autorizar no app do banco e copiar o Client ID/Secret uma vez.
- **Exceção à regra "serviços externos grátis e sem token"**: vale **só para este módulo**. Não
  use isso como precedente para outros serviços.
- Avisos são **honestos sobre o atraso**: nunca escreva "agora", "na hora" ou "em tempo real".

## Decisões que você precisa confirmar com o dono ANTES de implementar

**Respondidas em 2026-10-20:** o nome é **"Open Finance"** (tagline "Seus bancos no Capital, uma
vez por dia"); nada entra sozinho, cada item entra pela revisão **com um toque, sem "Lançar
todos"**; os avisos são **um resumo por sincronização**. Houve também um aviso próprio do salário; o dono o
tirou no mesmo dia ("bem inútil"): não reimplemente.

1. **Nome do módulo.** "Open Finance" é jargão; sugestão: **"Bancos conectados"** (tagline
   "Seus bancos no Capital, uma vez por dia"). Pergunte.
2. **Gastos e rendas entram sozinhos nos Lançamentos?** Recomendação: **não**; ficam numa caixa
   "Confira os gastos" e só entram com um toque (há duplicados, transferências entre contas
   próprias e pagamentos de fatura que não podem virar gasto). Pergunte se ele quer, além disso,
   um "Lançar todos".
3. **Avisos: um por compra ou um resumo por sincronização?** Recomendação: **um resumo por
   sincronização** ("Hoje chegaram do Nubank: 3 compras no cartão, R$ 120,00, e 1 Pix recebido,
   R$ 50,00") e um aviso separado só para o **salário**. Pergunte.

## O que a API da Pluggy faz (verificado em 2026-10-20; confirme na doc antes de usar)

**F0 feita em 2026-10-20:** o que está abaixo foi conferido com a chave do dono, e o resultado
completo está no `README.md` (seção "Open Finance pelo Meu Pluggy"). Diferenças e novidades:

- O caminho (a) funciona e não precisa de widget. O link de autorização vale **4 minutos** e cada
  autorização traz **um banco**.
- `GET /items` responde 401, não `LIST_ITEMS_FEATURE_NOT_ENABLED` (dá no mesmo).
- A primeira leitura traz ~12 meses.
- O nome do banco não vem no item: o Capital sugere e a pessoa edita.

Doc: https://docs.pluggy.ai. Fatos levantados (alguns vêm de projetos de terceiros, marcados com *):

- `POST /auth` com `clientId` e `clientSecret` devolve um `apiKey` de curta duração (confirme o
  prazo na doc). Tudo depois usa o header `X-API-KEY`.
- `POST /connect_token` gera um token de 30 minutos para a janela de conexão (Pluggy Connect);
  `options.oauthRedirectUri` é para onde a pessoa volta depois do OAuth. **Precisa ser HTTPS e não
  pode ser localhost/127.0.0.1.**
- O conector do Meu Pluggy tem id **200*** (confirme com `GET /connectors`). A conexão de cada banco
  vira um **item** no app da pessoa.
- `GET /items` (listar) **não funciona no plano grátis*** (`LIST_ITEMS_FEATURE_NOT_ENABLED`): o
  Capital precisa **guardar os itemIds** que ele mesmo criou. `GET /items/{id}` traz `status`,
  `lastUpdatedAt`, `nextAutoSyncAt` e `consentExpiresAt`.
- `PATCH /items/{id}` (forçar atualização) responde **400 "MeuPluggy item cant be updated"***.
- `GET /accounts?itemId=` lista contas (corrente, poupança, cartão de crédito) com saldo.
- `GET /v2/transactions?accountId=&dateFrom=&dateTo=` com paginação por cursor (`next`); a v1
  responde 410*; `page`/`pageSize` são rejeitados*. Cada sincronização Open Finance traz os
  **últimos 7 dias**.
- Transação: `id`, `description`, `descriptionRaw` (pode ser null), `amount`, `date`, `type`
  (`CREDIT`/`DEBIT`), `status` (`PENDING`/`POSTED`), `category`, `operationType` (só Open Finance),
  `paymentData` (pagador, recebedor, `paymentMethod` como PIX; pode ser null), `merchant` (nome,
  CNPJ, categoria; pode ser null), `creditCardMetadata` (`installmentNumber`, `totalInstallments`,
  `purchaseDate`, `payeeMCC`, `billId`). **No cartão, compra é positiva e pagamento é negativo*.**
  Alguns bancos não mandam o número da parcela*: calcule pelo `purchaseDate`.
- `GET /bills` traz só faturas **fechadas***. `GET /investments` traz fundos, ações, renda fixa.
- Problema conhecido: uma conexão do Inter **parou de atualizar por 13 dias sem erro nenhum**, com o
  painel verde (https://github.com/pluggyai/meu-pluggy/issues/26). O Capital precisa perceber
  dados velhos sozinho.
- Webhooks existem (`transactions/created` etc.), mas o Capital roda numa rede privada e pode não
  ser alcançável pela Pluggy: **use consulta periódica**, não webhook.
- Referências úteis: https://github.com/fellipefbarros/open-finance-pessoal (passo a passo do Meu
  Pluggy com a API) e a integração da Pluggy no Actual Budget.

## Fases, por ordem

Uma fase de cada vez; cada uma precisa ficar boa sozinha.

### F0 — Conferir a API de verdade (sem tela bonita)

Antes de desenhar telas, confirme o que está marcado com * acima e responda: **como o Capital cria
o item do Meu Pluggy** — (a) redirecionando a pessoa para uma página da Pluggy e voltando pelo
`oauthRedirectUri` (preferido: não precisa carregar script de terceiros) ou (b) só pelo widget
Pluggy Connect. Teste com as credenciais **do dono, que ele mesmo digita no app** (nunca peça para
colar no chat; você nunca digita credenciais). Lembre que o retorno do OAuth não aceita localhost:
combine com o dono como testar esse passo pelo endereço HTTPS do servidor. Anote no README o que
descobriu (incluindo quais campos os bancos do dono preenchem de fato) e mostre ao
dono antes de seguir.

### F1 — Módulo e conexão guiada, tudo pelo app

1. **Módulo novo** (chave sugerida `banks`, rota `/bancos`, grupo `wallet`, `dependsOn: []`,
   `vipOnly: true`). Pontos que todo módulo toca — siga o Monitor de Gmail como modelo:
   `ModuleFlags` em `lib/budget/types.ts`, `lib/modules/catalog.ts`, o enum de módulos em
   `lib/server/validation.ts`, ícone em `components/modules/visuals.ts`, card da Início em
   `components/modules/home/HomeCards.tsx`, tour e botão "?" em `lib/modules/tours.ts`, contexto da
   API em `lib/server/http.ts`, repositório em `lib/server/banks/` e cliente em `lib/storage/`.
   Cada rota confere no servidor que o módulo está ligado **e** que a conta é VIP (veja
   `lib/server/gmail/access.ts`, `lib/server/ai/access.ts` e `withAccessRules` em
   `lib/modules/flags.ts`).
2. **Configuração em passos** ("Passo 1 de 4"), uma linha e um botão por passo:
   1. **"Conecte seus bancos no Meu Pluggy"** → abre `https://meu.pluggy.ai` em outra aba. Uma linha:
      a autorização acontece no app do banco. Botão "Já conectei".
   2. **"Crie sua chave"** → abre `https://dashboard.pluggy.ai`. Mostre o mínimo para não se perder:
      usar o mesmo e-mail, criar uma aplicação e ativar o conector MeuPluggy (confirme na F0 os
      nomes atuais dos botões do dashboard).
   3. **"Cole aqui o Client ID e o Client Secret"** → o Capital testa na hora (`POST /auth`) e diz
      em uma frase o que deu errado. O aviso de "teste de 15 dias" do dashboard não vale para uso
      pessoal: diga isso em uma linha, porque assusta.
   4. **"Trazer meus bancos para o Capital"** → o fluxo descoberto na F0; o Capital guarda os
      itemIds sozinho e mostra os bancos que chegaram.
   - "Adicionar outro banco" refaz os passos 1 e 4. Mostre "3 de 5 conexões grátis".
   - "Desconectar" apaga do Capital as credenciais e as conexões (os lançamentos já feitos ficam) e
     aponta o meu.pluggy.ai para revogar lá.
3. **Segurança.** O Client Secret é cifrado com `lib/server/secretBox.ts` (como o token do Gmail),
   **nunca volta para o navegador** (mostre só "••••1234") e nunca vai para log. O `apiKey` fica só
   em memória. Toda chamada à Pluggy é do servidor; o CSP de `next.config.ts` só muda se a F0
   provar que o widget é inevitável, e aí com os domínios mínimos da Pluggy. Rate limit nas rotas
   que chamam a Pluggy (veja `lib/server/rateLimit.ts`).
4. **Dados da conta.** Inclua as tabelas novas na exclusão e na exportação (`lib/server/accountData.ts`)
   e explique o Meu Pluggy na página `app/privacidade`.

### F2 — Sincronização e a tela dos bancos

1. **Tabelas próprias** (migração com `npm run db:generate`): conexões (itemId, banco, status,
   `lastUpdatedAt`, `consentExpiresAt`), contas (tipo, nome, saldo, data do saldo) e transações
   da Pluggy (id externo único por usuário, todos os campos úteis, e o que virou no Capital).
   Nada disso é lançamento ainda.
2. **Job na agenda** (`lib/server/scheduler.ts`, com `job_runs` como os outros): para quem tem o
   módulo ligado, a cada hora olha `GET /items/{id}`; **só se `lastUpdatedAt` mudou** busca contas e
   transações (desde a última vez − 7 dias). Grava por id externo: atualiza o que mudou (pendente
   → confirmada), nunca duplica. Erro de uma pessoa não para as outras.
3. **Dados velhos e consentimento.** Conexão sem atualizar há mais de 48 h → status "parada", com
   aviso e botão para reconectar no Meu Pluggy. Avise 15 dias antes de `consentExpiresAt`.
4. **Tela `/bancos`**: número herói (saldo somado das contas), cada banco com "atualizado há 5 h"
   e o status, as contas com saldo, os cartões. Uma linha só explicando que o banco manda os dados
   uma vez por dia. "Verificar agora" relê a Pluggy (não força o banco), com limite.

### F3 — Reserva pelas contas que a pessoa escolher (precisa da Reserva ligada)

Na engrenagem da tela da Reserva (configuração de módulo fica na tela do módulo): **"Atualizar a
reserva em conta pelos bancos conectados"** → a pessoa marca uma ou mais contas e/ou investimentos,
**de qualquer banco** (nada vem marcado: o app não supõe qual banco é reserva e qual é do dia a
dia), e pode desmarcar ou trocar quando quiser. A "Reserva em conta"
(`cash_settings.reserve_account_amount`, editada em `CaixaScreen.tsx`, conta em
`lib/budget/cash.ts`) passa a vir da soma desses saldos a cada sincronização; o campo fica só
leitura com "Atualizado pelo {banco} há 5 h" e a opção "Voltar a digitar à mão". Se a conexão
estiver parada, o valor fica o último conhecido, com o aviso.

### F4 — Avisos no celular

1. Categoria nova de notificação (`NotificationCategory` e rótulos em `lib/notifications/types.ts`,
   chave nas preferências) com o nome do módulo; envio por `sendUserNotifications`
   (`lib/server/notify.ts`) com `sourceKey` para nunca repetir.
2. **Resumo por sincronização** (ou o formato que o dono escolher): compras no cartão, Pix
   enviados e recebidos, com valores. Tocar abre "Confira os gastos" (F5) ou, antes dela, a tela
   dos bancos.
3. ~~**Salário caiu**~~: feito e depois **tirado pelo dono** em 2026-10-20 ("bem inútil"). Não
   reimplemente.
4. Na engrenagem do módulo: o que avisar (compras, Pix enviados, Pix recebidos) e um
   valor mínimo opcional.

### F5 — "Confira os gastos" → Lançamentos (precisa de Lançamentos)

1. Caixa de entrada com o que chegou dos bancos e ainda não está no Capital. Débito sugere gasto,
   crédito sugere renda. Cada linha: descrição, valor, data, categoria sugerida, lápis para editar,
   "Lançar" e "Ignorar". Pense o pipeline **independente da fonte** (um "Importar extrato" OFX/CSV
   vai usar a mesma revisão depois).
2. **Categoria sugerida** pelas regras determinísticas de `lib/ai` (sem Ollama), pela categoria e
   loja da Pluggy e pelo que a pessoa já escolheu antes para a mesma descrição. Sem palpite →
   "não informado".
3. **Cartão.** A pessoa liga uma vez cada cartão da Pluggy a um cartão do Capital (ou "não
   informado"). Compra parcelada sugere o parcelamento, com as parcelas já pagas (o fluxo
   "Cadastrar uma que já vinha pagando"). Crie os lançamentos **pelas mesmas funções que o
   formulário usa**, para valerem as regras de fatura e de mês.
4. **Ignorados por padrão, com o motivo à vista**: pagamento de fatura de cartão (contaria duas
   vezes), transferência entre contas da própria pessoa, aplicação e resgate de investimento.
5. **Duplicados.** Mesmo valor, data ±2 dias (e mesmo cartão, se houver) que um lançamento manual →
   "Parece que você já lançou isso": "É o mesmo" (só liga os dois) ou "É outro". Um item da Pluggy
   nunca vira dois lançamentos (guarde o vínculo com restrição única).
6. **Fatura**: achar o pagamento da fatura no banco pode **sugerir** "Marcar a fatura de out como
   paga?", sempre com um toque. Nenhuma fatura sai sozinha.

### F6 — A receber (precisa do A receber ligado)

Pix recebido com o mesmo valor de um "A receber" em aberto (e, se houver, nome do pagador parecido
com a descrição) → na caixa "Confira os gastos": "É a devolução de 'Jantar — João' (R$ 50,00)?
Marcar como recebido". Um toque usa a mesma rota de hoje
(`app/api/v1/months/[month]/expenses/[id]/reimbursed`). Nunca automático.

## Regras do Capital que valem aqui

- **Nada dos costumes do dono.** Nenhum banco, conta ou cartão tem papel fixo (reserva, conta do dia
  a dia, salário); cada pessoa escolhe, com um padrão neutro, e muda quando quiser. Nada pode
  depender de um banco específico.

- Todo recurso é módulo, com tour e botão "?"; o tour **nunca** abre sozinho. Desligar o módulo
  nunca apaga dados.
- Configurações do módulo ficam na engrenagem da tela dele.
- Nenhum campo novo é obrigatório; "não informado" é opção de verdade.
- Nenhuma fatura sai sozinha; só "Fatura paga".
- Categorias nunca são excluídas, só arquivadas.
- Texto curto: no máximo uma linha de ajuda visível por tela; o resto atrás de ⓘ. Palavras do dia a
  dia ("Pix recebido", não "crédito"; "atualizado há 5 h", não "lastUpdatedAt").
- Voltar do celular fecha a janela de cima; sair de uma edição com mudanças pergunta "Salvar as
  alterações?" (só se mudou).
- A pessoa é chamada só pelo primeiro nome.
- Não escreva texto para o usuário que fale de servidor, `.env.local` ou "meu Orange Pi".

## Como trabalhar

1. Leia o `README.md`, `lib/modules/catalog.ts`, `lib/modules/flags.ts`, `lib/modules/tours.ts`,
   todo o Monitor de Gmail (`lib/server/gmail/`, `app/api/v1/gmail/`, `GmailScreen.tsx`,
   `lib/storage/gmail.ts`), `lib/server/scheduler.ts`, `lib/server/notify.ts`,
   `lib/server/secretBox.ts`, `CaixaScreen.tsx` e `lib/budget/cash.ts` antes de mexer.
2. Testes sem rede: simule a API da Pluggy com respostas gravadas (inclusive campos nulos, cartão
   com sinal invertido, pendente que vira confirmada, parcela sem número, conexão parada).
3. Ao terminar cada fase: suba o servidor com o `capital-dev` do `.claude/launch.json`, teste no
   navegador em tamanho de celular (375×812), claro e escuro. Quando cair no login, **peça para o
   dono entrar com a conta dele** — não crie conta nem digite senha ou credencial. Mostre capturas
   e espere a aprovação.
4. Só depois da aprovação: **um commit por fase**. Não faça push nem deploy sem o dono pedir.
5. Rode `npx vitest run --exclude ".claude/**" --exclude "node_modules/**"` e `npm run lint`.
6. Atualize o `README.md` (o módulo, a configuração e os limites do Meu Pluggy).

## Pronto quando

Todas as fases (F0 a F6) foram feitas em 2026-10-20, uma por commit; o que cada uma entrega está no
`README.md` (módulo Open Finance e `lib/server/banks`).

- [x] Um VIP liga o módulo e conecta os bancos sem sair do Capital, a não ser nos sites da Pluggy
      e do banco que o próprio app abre; quem não é VIP vê "VIP" e não liga.
- [x] O Client Secret fica cifrado, nunca chega ao navegador nem aos logs.
- [x] Transações chegam uma vez, sem duplicar; pendente que vira confirmada atualiza.
- [x] Conexão parada há mais de 48 h e consentimento perto de vencer geram aviso.
- [x] A Reserva pode vir do saldo de qualquer conta conectada que a pessoa marcar, e ela troca
      ou volta a digitar à mão quando quiser.
- [x] Avisos de compras e Pix chegam, sem prometer tempo real (o do salário saiu a pedido do dono).
- [x] "Confira os gastos" lança com um toque, sugere categoria, pega duplicados e ignora fatura e
      transferência entre contas próprias.
- [x] Testes e lint passando; README e página de privacidade atualizados.
