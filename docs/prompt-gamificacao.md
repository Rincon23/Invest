# Capital + gamificado: missões, XP e um app sem liga/desliga

## Contexto

Capital + é um PWA mobile-first de orçamento por categorias (Next.js 16 + Postgres no Orange Pi;
leia o `AGENTS.md` e os guias em `node_modules/next/dist/docs/` antes de escrever código). O
`README.md` descreve o comportamento atual. O plano `docs/prompt-app-intuitivo.md` (P1–P7) já foi
feito: kits no primeiro acesso, widget "Primeiros passos", Módulos em cards, glossário, telas com
número herói.

O pedido do dono (2026-10-26), nas palavras dele:

> "quero parar com essa opção de desativar e ativar módulos, isso só dificulta... mesmo que a
> pessoa não tenha cartão vai existir o módulo cartão pra ela"
>
> "quero que quando a pessoa entra no app ela tenha um sistema de recompensa onde vai fazendo
> missões, vai ganhando XP"
>
> "o XP não pode ser conseguido a partir de mentiras... vá mais para o caminho das pessoas
> entrarem no app e fazer coisas bem simples como registrar coisas e conferir coisas, conferir o
> calendário"
>
> "em algumas partes do app tem muito texto e a pessoa fica com preguiça de ler"

## Objetivo e como saber que deu certo

1. **Conta nova, primeiro minuto:** entra, vê no topo da Início o widget **Missões** com nível,
   barra de XP e as próximas missões; toca na primeira, faz, ganha XP com uma comemoração curta.
   Nenhuma escolha de módulos no caminho.
2. **Todo mês o app dá o que fazer:** as missões do mês (registrar a renda, lançar os gastos,
   conferir o calendário, conferir os bancos) puxam a pessoa de volta, em tarefas pequenas.
3. **Nada de liga/desliga:** nenhuma tela, tour, texto ou README fala em ligar/desligar módulo.
   Todo módulo existe para todo mundo (exceto os Restritos, ver abaixo).
4. **Menos texto:** a contagem de textos de interface com 60+ caracteres cai pela metade (meça
   antes e depois com um script simples e diga os dois números).

## Diagnóstico (o que existe hoje)

- **Liga/desliga:** `lib/modules/flags.ts` (`NO_MODULES`, `resolveModules`, `turnModuleOn/Off`,
  `turnModulesOn`, árvore de dependências); `createDefaultSettings` em `lib/budget/seed.ts` começa
  com `modules: {}`. Telas: `ModulosScreen` (`/modulos`), `UsageChooser` + `lib/modules/kits.ts`
  ("Como você quer usar o Capital?"), `useModuleSwitch`, `ModuleGate`. ~100 lugares chamam
  `isModuleOn`/`resolveModules`, inclusive no servidor (`lib/server/*/access.ts`,
  `walletRepository`, `diagramRepository`, `validation.ts`, rotas de `wallet/cash` e
  `banks/holdings`).
- **Início:** `lib/modules/home.ts` monta as telas padrão a partir dos módulos ligados;
  `settings.homeHidden` e as páginas salvas guardam o que cada um arrumou.
- **Primeiros passos:** `lib/modules/firstSteps.ts` + `FirstStepsHomeCard` (3 itens, salvos em
  `dismissed_notices` como `first-steps:*`). Vira parte das missões.
- **Conta de teste:** `lib/server/testAccount.ts` (`TEST_ACCOUNT_*`) é o modelo para a conta
  modelo da Início (G1.5).
- **Texto:** medição grosseira (strings e textos JSX com 60+ caracteres) deu ~67, concentrados em
  `GmailScreen`, `InvestedReserve`, `BanksScreen`, `BankReviewScreen`, `CaixaScreen`,
  `CartaoScreen`, `ConfiguracoesScreen`, `LoginScreen`, `lib/modules/tours.ts` e as `description`
  do `catalog.ts`. Refaça a medição com o seu script antes de começar.

## Princípios do XP (decisão do dono: XP não pode vir de mentira)

1. **XP premia uso, nunca resultado.** Entrar, registrar e conferir dão XP. Quanto investiu,
   meta batida, quanto sobrou: **nunca**. Resultado depende do que a pessoa digita e da vida dela
   (tem mês sem renda); uso é honesto por natureza.
2. **XP fixo por ação, nunca proporcional a R$.** Um gasto de R$ 1 vale o mesmo que um de R$ 1.000.
3. **Cada missão vale uma vez por período** (dia, semana, mês ou conta). Lançar 50 gastos dá o
   mesmo XP que lançar 1. Apagar e refazer não dá de novo; apagar também não tira o XP.
4. **Relógio do servidor.** Dia, semana e mês contam pela data do servidor (fuso de Brasília),
   nunca pela do celular.
5. **Sem ranking e sem prêmio.** O XP é só da pessoa; não destrava nada pago (o projeto não vende
   nada). Se um dia houver ranking, a verificação precisa ser repensada.
6. **Recompensa, nunca castigo.** XP não diminui, não há "você falhou" nem "perdeu a sequência".
7. **Curto.** Título de missão até ~30 caracteres, sem descrição. Comemoração: "+15 XP" e pronto.
8. **Toque leva ao lugar.** Cada missão é um botão que abre o lugar certo e destaca o único botão a
   tocar (um passo de spotlight do driver.js). Só **depois do toque**: tour nunca abre sozinho.

## Fases (uma de cada vez, nesta ordem; cada uma fica boa sozinha)

### G1 — Fim do liga/desliga e Início padrão

1. Todo módulo que a conta pode ver fica **sempre ligado**. `resolveModules` passa a depender só
   do acesso (Restrito); o campo `modules` salvo é ignorado (a coluna fica, nenhum dado é apagado).
2. Saem: a tela Módulos (`/modulos` redireciona para a Início), a entrada dela na gaveta de apps,
   `UsageChooser`, `kits.ts`, `useModuleSwitch`, a árvore de dependências, os toasts/cadeados e
   todo texto e tour que fala em ligar módulo. `ModuleGate` fica só para o Restrito (404).
3. Ficam: a engrenagem de configurações em cada módulo, o "?" de ajuda, a gaveta com todos os
   módulos (Privacidade acima de Configurações), os widgets da Início com "−" / "Adicionar widget".
4. **Módulo sem uso tem estado vazio de uma linha + um botão** (Cartão sem cartão: "Nenhum
   cartão." + "Cadastrar cartão"; Gmail sem configuração no servidor continua com a linha curta
   para quem não é dono).
5. **Conta modelo da Início (`adm_widget`).** Uma conta só para isso, configurada como a de teste:
   `HOME_TEMPLATE_EMAIL` e `HOME_TEMPLATE_PASSWORD` no `.env`, criada pelo servidor já confirmada,
   **sem** zerar a cada login. O que o dono arrumar na Início dela (telas, ordem, widgets
   tirados) é a Início de **toda conta nova**. Ela não ganha XP, não recebe aviso e não aparece em
   nenhuma contagem da Administração. Widget de módulo Restrito sai da cópia para quem não tem
   acesso. Nunca digite nem mostre a senha: o dono põe no `.env` do Pi.
6. **Começo da conta modelo:** a Início **atual do dono** (`OWNER_EMAIL`), com o widget Missões
   no topo da primeira tela.
7. **Contas que já existem:** uma vez só, no deploy, a Início de todas (menos a do dono e a modelo)
   passa a ser a da conta modelo. Depois cada um muda e tira o que quiser. Mudanças futuras na
   conta modelo valem só para contas novas.
8. **Servidor:** onde uma rota ou job recusava por módulo desligado, agora só o Restrito recusa.
   Confira que jobs e avisos (fatura, contas do mês, lembretes, Gmail, Open Finance) não passam a
   mandar nada para quem não tem dado: sem cartão, nenhum aviso de fatura.

### G2 — Módulo e widget Missões

1. **Regras puras em `lib/gamification/`** (sem React, com testes): catálogo de missões (chave,
   título, XP, período, quando aparece), curva e nomes de nível. O catálogo precisa ser fácil de
   mexer: o dono vai ajustar missões e XP depois de ver ("vamos vendo como fica").
2. **Guardar no servidor.** Sugestão: tabela `xp_events (user_id, mission, period, xp, earned_at)`
   com **chave única `(user_id, mission, period)`**: é ela que garante "uma vez por período"
   (`period` = `2026-10-26` no dia, `2026-W44` na semana ISO, `2026-10` no mês, `once` na
   primeira vez). Migração pelo Drizzle; leia antes a skill `supabase-postgres-best-practices`. O
   servidor confere a condição (o gasto existe, a tela foi aberta) e usa a própria data.
3. **Missões** (proposta inicial; o dono ajusta depois):

   **Do dia**

   | Missão | XP | Feita quando |
   | --- | --- | --- |
   | Abrir o app | 10 | primeira abertura do dia |

   **Da semana** (semana de segunda a domingo)

   | Missão | XP | Feita quando |
   | --- | --- | --- |
   | Conferir os bancos | 15 | abriu a conferência do Open Finance na semana — **só para quem tem acesso ao Restrito; invisível para os outros** |

   **Do mês** (recomeçam no dia 1; cada linha vale uma vez no mês)

   | Missão | XP | Feita quando |
   | --- | --- | --- |
   | Registrar uma renda | 30 | primeira renda do mês |
   | Lançar um gasto | 30 | primeiro gasto do mês, em qualquer categoria (a categoria nunca muda o XP) |
   | Conferir o calendário | 15 | abriu a aba Calendário dos Lembretes |
   | Conferir as contas do mês | 15 | abriu Contas do mês (só para quem tem conta cadastrada) |
   | Conferir a fatura | 15 | abriu o Cartão (só para quem tem cartão cadastrado) |
   | Conferir a reserva | 15 | abriu a Reserva |
   | Fechar o mês anterior | 50 | fechou o mês passado |

   **Primeira vez** (uma por conta)

   | Missão | XP | Feita quando |
   | --- | --- | --- |
   | Registrar sua primeira renda | 50 | primeira renda da conta |
   | Lançar seu primeiro gasto | 50 | primeiro gasto da conta |
   | Ajustar suas categorias | 50 | terminou as perguntas de Categorias |
   | Conhecer cada módulo | 20 cada | primeira vez que abre a tela de cada módulo (A receber e Lançar por voz, que não têm tela: primeiro uso). Restrito só para quem tem acesso |
   | Criar seu primeiro lembrete | 30 | primeiro lembrete |
   | Instalar o app no celular | 30 | app aberto instalado (PWA) |
   | Ligar as notificações | 30 | push ativo no aparelho |
   | Conectar um banco | 100 | primeira conexão do Open Finance (só Restrito) |

4. **Níveis com nome que melhora.** O app não sabe o gênero da pessoa, então nada de
   "Organizado/Poupador": os nomes são de uma árvore que cresce, como o dinheiro.

   | Nível | XP | Nome |
   | --- | --- | --- |
   | 1 | 0 | Semente |
   | 2 | 150 | Broto |
   | 3 | 400 | Muda |
   | 4 | 800 | Arbusto |
   | 5 | 1.400 | Árvore |
   | 6 | 2.200 | Árvore florida |
   | 7 | 3.300 | Árvore com frutos |
   | 8 | 4.800 | Pomar |
   | 9 | 6.800 | Bosque |
   | 10 | 9.500 | Floresta |

   Conta: quem faz o começo e abre o app quase todo dia ganha ~800 XP no primeiro mês (nível 4) e
   ~420 XP por mês depois (~480 com o Open Finance); a Floresta leva quase dois anos. Ajuste a curva se os números
   reais ficarem longe disso.
5. **Widget Missões** (substitui "Primeiros passos", no topo da Início): nome do nível, barra até o
   próximo, e as missões abertas que importam agora (primeiro as de "primeira vez", depois as do
   mês), até 3, cada uma com o XP. "Ver todas" abre o módulo. Sai pelo "−" como qualquer widget.
6. **Módulo Missões** (entrada na gaveta, tela própria, "?" com tour curto): no topo o nível e a
   barra; abaixo "Do mês" (com o quanto falta: "5 de 9"), "Primeira vez" e o XP de cada mês.
7. **Comemoração:** ao concluir, "+15 XP" com animação curta; ao subir de nível, um cartão pequeno
   com o nome novo. Respeite `prefers-reduced-motion`.
8. **Contas antigas:** as missões de "primeira vez" que os dados já mostram contam sozinhas, com um
   único aviso ("Você já tinha 340 XP · Muda"), sem uma comemoração por missão. As do dia e do mês
   começam a contar a partir do deploy.

### G3 — Menos texto (de novo)

1. Por tela: no máximo **uma linha de ajuda visível, até ~60 caracteres**; o resto vai para ⓘ ou
   sai. Confirmações: título + uma frase curta.
2. Tours: até 3 passos, uma linha cada. `description` do `catalog.ts`: até ~80 caracteres.
3. Comece pelos arquivos do diagnóstico. Não perca regra de negócio: se o texto explicava uma
   regra, a regra vira visual (prévia, selo, número) ou ⓘ.
4. Meta: textos 60+ caracteres pela metade. Diga antes e depois.

## Decisões que já são do dono e NÃO mudam

- **Restrito** (no código `vip`): grupo de beta testers, não é pago. Quem não tem acesso nunca sabe
  que o módulo existe (fora da gaveta, da bandeja, das missões, da cópia da Início modelo; o
  endereço dá "Página não encontrada").
- **Categorias ficam como estão hoje**, para contas novas e antigas: a pessoa cria e arquiva
  livremente (o dono quer dar essa liberdade); nunca excluídas; "Restaurar categorias padrão" e o
  conselho de ficar com as 4 padrão continuam (o conselho pode ficar mais curto na G3).
- Tour nunca abre sozinho; só pelo "?" ou pelo toque numa missão. As perguntas de configuração
  das Categorias continuam abrindo na primeira visita.
- Nenhum campo novo é obrigatório; "Não informado" é opção de verdade.
- Nenhuma fatura sai sozinha; só "Fatura paga".
- Início sem seletor de mês; gestos com a física de tela de celular; widget ≠ módulo.
- Configurações de módulo na engrenagem da tela do módulo.
- Investimentos é só investimento; recompor a reserva vai em Imprevistos.
- A pessoa é chamada só pelo primeiro nome; o app se chama "Capital +", com espaço sem quebra
  (U+00A0) antes do "+"; "baldes" nunca aparece.
- Serviços externos só grátis e sem token.

## Como trabalhar

1. Leia o `README.md`, `lib/modules/*`, `HomeScreen.tsx`, `FirstStepsHomeCard.tsx`,
   `OnboardingWizard.tsx`, `lib/server/testAccount.ts` e as telas da fase antes de mexer.
2. Uma fase por vez. Ao fim de cada uma: suba o `capital-dev` do `.claude/launch.json` e teste no
   seu navegador em 375×812, claro e escuro. Para primeiro acesso use a conta de teste `.test`
   (`TEST_ACCOUNT_*` no `.env.local`, zera a cada login; nunca escreva a senha no chat). Se cair
   no login da conta do dono ou da conta modelo, peça para ele entrar.
3. Não precisa mandar capturas nem esperar aprovação por fase: teste, corrija, **um commit por
   fase**. Ao terminar tudo, push e deploy no Orange Pi (`update.sh`). Antes do deploy, lembre o
   dono de pôr `HOME_TEMPLATE_EMAIL` / `HOME_TEMPLATE_PASSWORD` no `.env` do Pi.
4. Rode `npx vitest run --exclude ".claude/**" --exclude "node_modules/**"`, `npm run lint` e
   `npx tsc --noEmit`; atualize ou remova os testes de Módulos, kits, `UsageChooser`,
   `FirstStepsHomeCard` e `flags`.
5. Atualize o `README.md` e as memórias que esta mudança substitui (todo recurso é módulo
   ligável, dependências com cadeado, kits, "Primeiros passos").

## Pronto quando

- [ ] Conta nova abre a Início da conta modelo, com Missões no topo, e ganha XP na primeira
      missão, sem escolher módulos.
- [ ] Contas existentes receberam a Início modelo uma vez e podem mudá-la.
- [ ] Nenhuma missão dá XP por resultado ou por valor; cada uma vale uma vez por período, pela
      data do servidor.
- [ ] Não existe mais tela, botão, texto ou tour de ligar/desligar módulo; Restrito continua
      invisível para quem não tem acesso.
- [ ] Textos de 60+ caracteres pela metade (antes e depois informados).
- [ ] Testes, lint e tipos passando; README e memórias atualizados; deploy feito.
