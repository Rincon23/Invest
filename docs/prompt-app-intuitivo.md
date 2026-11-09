# Capital sem precisar de curso: deixar o app intuitivo e com menos texto

## Contexto

Capital é um PWA mobile-first de orçamento por categorias (Next.js 16 + Postgres no Orange Pi,
leia o `AGENTS.md` e os guias em `node_modules/next/dist/docs/` antes de escrever código). Tudo
é módulo (`lib/modules/catalog.ts`), a Início é um launcher estilo celular
(`components/modules/home/HomeScreen.tsx`) e a ajuda de cada módulo é um tour do driver.js
(`lib/modules/tours.ts`). O `README.md` descreve o comportamento atual em detalhe.

O problema, nas palavras do dono: **"tenho medo do usuário ficar perdido, sinto que precisa de um
curso para começar a usar o app, e tem muito texto — queria que as coisas fossem mais
intuitivas"**. O app tem regras de negócio boas e bem pensadas; o que falta é a pessoa entender
o app **usando**, sem ler parágrafos.

## Objetivo e como saber que deu certo

1. **Primeiros 2 minutos:** quem nunca viu o Capital cria a conta, registra a renda, lança o
   primeiro gasto e vê "quanto ainda posso gastar", **sem ler nenhum parágrafo** e sem abrir
   nenhum tour.
2. **Teste dos 5 segundos em toda tela:** olhando 5 segundos, dá para dizer (a) que tela é,
   (b) qual é o número principal e (c) qual é a ação principal.
3. **Metade do texto:** hoje há ~126 textos de interface com 90+ caracteres em `components/`
   (mais concentrados em `QuestionsSheet`, `GmailScreen`, `InstallmentFormSheet`, `CartaoScreen`,
   `HomeScreen`, `OnboardingWizard`, `ReminderFormSheet`, `ReservaScreen`). A meta é **cortar
   pelo menos pela metade**, sem perder nenhuma regra de negócio. Meça antes e depois com um
   script simples que procura strings e textos JSX longos e diga o número final.

## Princípios (valem para tudo o que você mexer)

1. **Mostrar em vez de explicar.** Uma prévia com números, uma barra, uma linha do tempo de
   meses ou um ícone ensina mais do que uma frase. Se uma frase descreve o que a tela já mostra,
   ela sai.
2. **Orçamento de texto.** Por tela, no máximo **uma linha de ajuda visível** (até ~80
   caracteres). O resto vai para um **ⓘ / "Por quê?"** que abre ao tocar. Confirmações: título +
   uma frase curta. Onde der para desfazer, prefira **"Desfazer"** a perguntar antes.
3. **Uma ação principal por tela**, com destaque visual; as outras ficam secundárias.
4. **Palavras do dia a dia** (veja o glossário abaixo). Nada de termo de contador ou de banco
   quando existe palavra comum.
5. **Ensinar no momento certo.** Estado vazio com um botão que já faz a coisa; dica que aparece
   **uma vez** quando a pessoa chega no lugar (guardada em `dismissed_notices`, como as outras).
   O tour continua só no botão "?" — **nunca** volta a abrir sozinho.
6. **Feedback que ensina.** Depois de uma ação, mostrar o efeito dela em números (ver P4).

## Diagnóstico (o que encontrei no código)

- **Conta nova começa vazia e o primeiro passo é técnico.** Todos os módulos começam
  desligados; a Início mostra "Escolha o que o seu Capital vai ter" e manda para Módulos. Lá, a
  pessoa encontra uma árvore de dependências com cadeados, títulos "X e o que depende dele" e
  "Funcionam sozinhos", um parágrafo de explicação e, se tocar num módulo travado, a linha
  balança e um toast diz "ligue antes A e B, nessa ordem". Antes de lançar um gasto, ela precisa
  entender o que é módulo e dependência. **É aqui que nasce a sensação de "curso".**
- **O coração do app fica escondido.** "Quanto ainda posso gastar" (o motivo de existir do
  Capital) está no módulo "Gastos por categoria", que depende de "Lançamentos" — dois módulos para
  ligar na ordem certa antes de ver o que o app promete.
- **Navegação invisível.** Não há barra inferior: a lista de apps fica atrás de uma setinha
  (`aria-label="Abrir todos os apps"`), as áreas da Início trocam com deslizar, o modo de edição
  abre segurando, o mês troca com deslizar. São gestos bons para quem já sabe, mas nada na tela
  avisa que eles existem.
- **"À vista" com dois sentidos no mesmo formulário.** Em `ExpenseFormSheet`, "Como você pagou?"
  oferece **À vista / Parcelado**; logo abaixo, `InstallmentOptions` pergunta "Como entra no
  orçamento" com **À vista / Em parcelas**. A mesma palavra significa "pagamento" numa linha e
  "contabilização" na seguinte.
- **A pergunta do cartão quase não aparece.** O botão "Cartão" ao lado do valor fica com 50% de
  opacidade, sem borda, até ser tocado.
- **Explicações sempre abertas.** `REIMBURSABLE_EXPLANATION`, `UNCOUNTED_ADVICE` +
  `UNCOUNTED_EXPLANATION`, `FIXED_COST_TIP`, `KEEP_DEFAULT_TOPICS_ADVICE`,
  `RESERVE_PLAN_EXPLANATION` (5 linhas), os parágrafos de `InstallmentFormSheet`, a descrição da
  categoria em cada `TopicCard`, o texto de cada passo do onboarding.
- **Salvar um gasto não dá retorno.** O "Lançar gasto" da Início/Lançamentos fecha a janela e
  pronto: a pessoa não vê o que aquele gasto fez com a categoria.
- **Jargão:** "competência", "Gap da reserva", "Reserva prevista", "Saldo geral" ao lado de
  "Posso gastar", "aderência à meta", "remanejar", "estorno", "reserva livre", "rateio",
  "áreas de trabalho".
- **Instruções de servidor para o usuário final.** `GmailScreen`, com o Gmail não configurado,
  mostra a qualquer pessoa como criar o OAuth no Google Cloud e editar o `.env.local`.
- **Onboarding das categorias com 6 passos**, sendo um só de introdução e outro só de leitura
  ("Para que serve cada categoria").

## Mudanças, por prioridade

Faça uma fase de cada vez, nesta ordem. Cada fase precisa ficar boa sozinha.

### P1 — Primeira experiência (a mais importante)

1. **"Como você quer usar o Capital?"** logo depois do primeiro login (só para conta sem nenhum
   módulo ligado): 3 cartões grandes, com ícone e uma linha cada:
   - **Controlar meus gastos** → Lançamentos + Gastos por categoria;
   - **Gastos e cartão de crédito** → os dois acima + Cartão;
   - **Escolher do meu jeito** → abre Módulos.
   Um toque liga o conjunto e leva direto ao passo seguinte. Dá para trocar depois em Módulos.
2. **Configuração das categorias em 3 passos**, não 6: renda → custos fixos e imprevistos na
   mesma tela → percentuais com a prévia em R$. A descrição de cada categoria vira o subtítulo da
   linha dela no passo dos percentuais (some o passo só de leitura e a tela só de introdução).
   O "Pular" continua.
3. **Widget "Primeiros passos" na Início**, com 3 itens que se marcam sozinhos: *Registrar a
   renda*, *Lançar o primeiro gasto*, *Ver quanto ainda posso gastar*. Cada item é um botão que
   abre o lugar certo. Some quando os três estiverem feitos e, como qualquer widget, sai pelo "−".

### P2 — Navegação que se mostra

1. A setinha da Início ganha um rótulo curto ("Apps") e, nas primeiras vezes, um pulinho
   discreto para cima. Para de animar depois que a pessoa abre a bandeja uma vez.
2. Com mais de uma área, uma dica única ("Deslize para ver a outra tela") na primeira vez.
3. Nas telas com mês (Lançamentos, Categorias, Fatura), uma dica única de que dá para deslizar o
   mês; as setas ‹ › continuam.
4. Nada disso pode virar tour automático: são dicas pequenas, de uma vez só, que somem sozinhas.

### P3 — Tela Módulos sem cara de árvore técnica

1. Cards agrupados pelos grupos do catálogo (Dinheiro do mês, Carteira, Investimentos,
   Assistente): ícone, nome, `tagline` e o switch. A `description` só aparece ao tocar no card.
2. Sai o parágrafo do topo e os títulos "X e o que depende dele" / "Funcionam sozinhos".
3. Módulo dependente mostra um selo "Precisa de *Pai*". Tocar abre uma janelinha:
   "Para usar *Histórico*, ligue também *Gastos por categoria*", com o botão **"Ligar os dois"**
   e "Agora não". **(Decisão do dono, veja abaixo.)**

### P4 — Lançar gasto sem dúvida

1. **Acabar com o "À vista" duplo.** O pagamento continua "**À vista** / **Parcelado**" (é como
   todo mundo fala). Quem muda é o orçamento: "**Contar tudo neste mês** (recomendado)" /
   "**Contar uma parcela por mês**". Ajuste também os textos de `InstallmentFormSheet`, do
   recorrente parcelado, da aba Parcelados e dos tours.
2. **Pergunta do cartão visível**: um seletor claro ("Pagou com: Dinheiro/Pix · Cartão") ou o
   botão atual com borda e opacidade normais. Mantenha "A compra foi no cartão?" como rótulo
   acessível.
3. **Prévia do parcelamento como imagem**: uma faixa de meses ("out ▸ nov ▸ … ▸ jul",
   "10× R$ 87,24") em vez das frases de `InstallmentOptions`.
4. "A receber" e "Fora do orçamento": o selo ("Não recomendado") fica; a explicação vira uma
   linha curta + ⓘ.
5. **Retorno depois de salvar**: toast "R$ 45,00 em Diversos · ainda dá R$ 320,00 este mês"
   (ou "passou R$ 30,00 da meta"), com **Desfazer**. É assim que a pessoa aprende a categoria.

### P5 — Palavras do dia a dia

Só o texto da interface muda; identificadores de código, colunas e rotas ficam como estão.
Proposta de glossário (ajuste o que soar estranho, mas mantenha consistente no app inteiro,
inclusive tours, notificações e README):

| Hoje | Proposta |
| --- | --- |
| competência / "na competência de out/26" | "na fatura de out/26" / "no mês de out/26" |
| Gap da reserva | Falta para a reserva (ou "Reserva completa ✓") |
| Reserva prevista | Meta da reserva |
| Posso gastar + Saldo geral (lado a lado) | **Ainda posso gastar** como número principal; o outro vira secundário com nome claro ("Sobrou da renda") ou sai |
| Aderência à meta | Dentro do planejado |
| Remanejar | Guardar / Retirar |
| estorno | devolução |
| reserva livre | sem categoria |
| rateio / proporcional | dividido entre as categorias |
| áreas de trabalho | telas |

### P6 — Telas densas: um número herói e uma ação

Para **Cartão**, **Reserva de emergência**, **Reserva investida**, **Diagrama** e **Lembretes**:
no topo, o número que responde à pergunta da tela e a ação principal; o detalhe fica embaixo ou
recolhido. Exemplos:
- Reserva de emergência: "R$ 8.000 de R$ 12.000" com barra/anel e "Faltam R$ 4.000"; reserva em
  conta, investida e dívidas num "Ver detalhes". O texto do plano vira uma linha + ⓘ.
- Cartão / Fatura: valor, vencimento e "Fatura paga" em destaque; a lista vem abaixo.
- Estados vazios: uma linha + um botão (ex.: Parcelados vazio → "Nenhuma compra parcelada." +
  "Cadastrar uma que já vinha pagando").

### P7 — Ajuda e avisos

1. Tours mais curtos: até 4 passos por módulo, descrição de no máximo uma linha. O teste que
   confere âncoras e o botão "?" em todo módulo continua passando.
2. `GmailScreen` sem configuração: instruções de Google Cloud / `.env.local` **só para o dono**
   (`OWNER_EMAIL`, como a Administração); os outros veem uma linha dizendo que o monitor ainda não
   está disponível neste servidor e podem cadastrar as palavras-chave.
3. Confirmações (`useConfirm`): título + uma frase. Revise as de `CategoriesSettings`,
   `ConfiguracoesScreen`, `CartaoScreen`, `ReservaScreen`, `RecorrentesScreen`, `HomeScreen`.

## Decisões que já são do dono e NÃO mudam

- Todo recurso é módulo; desligar nunca apaga dados; módulo VIP mostra "VIP" (nunca "Em breve").
- Tour **nunca** abre sozinho; só o "?" de cada módulo. Só as perguntas de configuração das
  Categorias abrem na primeira visita.
- Categorias nunca são excluídas, só arquivadas; "Restaurar categorias padrão" continua; o
  conselho de não criar categorias fica ao lado de toda forma de criar (pode ficar mais curto).
- "À vista" (agora "Contar tudo neste mês") continua recomendado e pré-selecionado, e "Em
  parcelas" continua existindo e funcionando.
- "Recomendado" / "Não recomendado" continuam marcando Fora do orçamento, renda para uma
  categoria só e recompor a reserva como imprevisto.
- Nenhum campo novo é obrigatório; "Não informado" é opção de verdade.
- Nenhuma fatura sai sozinha; só "Fatura paga".
- Início sem seletor de mês; gestos com a física de tela de celular; widget só sai pelo "−".
- Configurações de módulo ficam na engrenagem da tela do módulo.
- A pessoa é chamada só pelo primeiro nome; "baldes" nunca aparece (são "categorias da reserva").

## Decisões que você precisa confirmar com o dono ANTES de implementar

1. **Kits de módulos no primeiro acesso (P1.1)** e **"Ligar os dois" (P3.3)**: hoje a regra é
   que o app nunca liga o módulo pai por conta própria. Aqui a pessoa escolhe explicitamente
   ligar os dois — pergunte se o dono aceita essa exceção. Se não aceitar, mantenha o cadeado e
   troque o toast por uma linha clara dentro do próprio card.
2. **Glossário (P5)**: mostre a tabela e pergunte o que ele quer manter.
3. **"Saldo geral"**: pergunte se pode sair da Início ou só mudar de nome.

## Como trabalhar

1. Leia o `README.md`, `lib/modules/catalog.ts`, `lib/modules/tours.ts`, `HomeScreen.tsx`,
   `ModulosScreen.tsx`, `ExpenseFormSheet.tsx`, `InstallmentOptions.tsx`,
   `OnboardingWizard.tsx` e as telas da fase antes de mexer.
2. Uma fase por vez. Ao terminar cada fase: suba o servidor com o `capital-dev` do
   `.claude/launch.json`, teste você mesmo no navegador em tamanho de celular (375×812), claro e
   escuro. Quando cair no login, **peça para o dono entrar com a conta dele** — não crie conta nem
   digite senha. Mostre capturas de tela e espere a aprovação.
3. Só depois da aprovação: **um commit por fase** (sem commits de cada ajuste visual). Não faça
   push nem deploy sem o dono pedir.
4. Rode `npx vitest run --exclude ".claude/**" --exclude "node_modules/**"` e `npm run lint`;
   atualize os testes que dependem de textos e de âncoras de tour.
5. Atualize o `README.md` onde o comportamento ou os nomes mudarem.

## Pronto quando

- [ ] Conta nova chega a "quanto ainda posso gastar" em até 2 minutos, sem tour e sem parágrafo.
- [ ] Nenhuma tela tem mais de uma linha de ajuda visível; o resto está atrás de ⓘ.
- [ ] Textos longos (90+ caracteres) caíram pelo menos pela metade; diga o antes e o depois.
- [ ] "À vista" não aparece mais com dois sentidos.
- [ ] Salvar um gasto mostra o efeito na categoria, com Desfazer.
- [ ] Gestos da Início têm sinal visível na primeira vez.
- [ ] Usuário comum não vê instruções de servidor.
- [ ] Testes e lint passando; README atualizado.
