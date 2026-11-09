# As 4 categorias fixas e as tags: categoria é meta, tag é rótulo

## Contexto

Capital é um PWA mobile-first de orçamento por categorias (Next.js 16 + Postgres no Orange Pi;
leia o `AGENTS.md` e os guias em `node_modules/next/dist/docs/` antes de escrever código). O
`README.md` descreve o comportamento atual; siga as regras de "Palavras da interface" e "Pouco
texto" de lá.

O pedido do dono (2026-11-05), nas palavras dele:

> "Não quero mais que a pessoa possa criar ou arquivar categorias, e trocar o nome de Diversos
> para Prazeres e Confortos. A pessoa apenas terá 4 metas de gasto; os custos fixos e imprevistos
> ainda continuam iguais. Deverá ter apenas 4 categorias, pois entendemos que uma pessoa deve ter
> 4 metas para os gastos da vida dela."
>
> "Podem ser adicionadas tags em cada gasto e renda, exemplos de tags de gasto: mercado,
> restaurante, viagem, e também pode ser adicionada tag nas rendas, como bico ou trabalho...
> quero que essas tags sejam editáveis, essas tags servem para serem filtradas na aba de
> lançamentos, por exemplo a pessoa quer ver quanto ela gastou no mercado este mês, então ela vai
> filtrar pela tag mercado... que ela entenda que existe diferença entre tag e categorias, as
> categorias são sobre as metas de gastos, a tag é apenas para controle, não muda nada da lógica"

As duas partes se completam. Hoje, quem queria acompanhar "Mercado" separado criava uma
categoria. Agora as categorias são sempre as mesmas 4 metas, e o que a pessoa quer acompanhar à
parte vira tag.

Faça na ordem: **Parte 1** (categorias) e depois **Parte 2** (tags), um commit para cada.

---

# Parte 1: só as 4 categorias, com nomes fixos

## Como fica

- Toda conta tem **exatamente estas 4 categorias**, nesta ordem (a ordem atual):
  1. **Prazeres e Confortos** (era "Diversos")
  2. **Investimentos**
  3. **Metas**
  4. **Conhecimentos**
- **Custos Fixos, Imprevistos, A receber e Fora do orçamento não mudam.** Continuam como estão,
  inclusive podendo trocar o nome e a cor na engrenagem.
- **Nas 4 categorias, a pessoa só muda a % e a cor.** O nome e a descrição são fixos, vêm sempre
  de `DEFAULT_TOPICS` (`lib/budget/topics.ts`), e a pessoa não cria, não arquiva e não renomeia.
- O `preset` continua `'diversos'` no código e no banco. Só o texto muda, como já é regra do
  README ("só o texto muda; código, colunas e rotas continuam como estavam").
- Nova descrição de Prazeres e Confortos (a atual repetiria o nome): **"Passeios, presentes,
  restaurantes e o que poderia esperar, mas você quer agora."**

## O que sai da interface

- **"+ Adicionar categoria"**, em `components/settings/CategoriesSettings.tsx` e em
  `components/onboarding/OnboardingWizard.tsx`.
- **"Arquivar"** e **"Desistir"**, em `CategoriesSettings`.
- Os campos de **nome** e de **descrição** das 4 categorias. O nome vira texto e a descrição
  aparece só para leitura.
- Os avisos `KEEP_DEFAULT_TOPICS_ADVICE` e `KEEP_DEFAULT_TOPICS_SHORT` (e as constantes), e o
  erro "Dê um nome para cada categoria".
- **"Restaurar categorias padrão"** vira **"Voltar às % padrão"**: devolve as % e as cores de
  `DEFAULT_TOPICS`, com "Desfazer". O "Me ajude com as %" continua igual.

## O servidor garante

A regra não pode depender só da tela.

- Ao salvar as configurações (`settingsSchema` em `lib/server/validation.ts` e `saveSettings` em
  `lib/server/budgetRepository.ts`):
  - As categorias são sempre as 4 dos presets.
  - O servidor aceita só `targetPct` e `color` de cada uma.
  - Nome, descrição, ordem e `archived` vêm sempre de `DEFAULT_TOPICS`.
  - Uma categoria nova enviada por um cliente antigo é ignorada.
  - A soma das % continua com a validação que já existe.
- Escreva uma função pura em `lib/budget/topics.ts`, por exemplo `enforceFixedTopics(topics)`,
  que recebe qualquer lista e devolve as 4 certas, mantendo os ids e as % que já existem. Use a
  mesma função no salvar, no seed de conta nova e no importar backup.
- `keepEveryTopic` e `restoreDefaultTopics` perdem o sentido. Tire-as, ou troque por
  `enforceFixedTopics`, junto com os testes delas.

## Contas que já existem: migração de uma vez

Use o mesmo padrão de `lib/server/fixedCostLabelMigration.ts`: roda uma vez na primeira subida
depois da atualização, marcada em `job_runs`. Para cada conta:

- As 4 categorias de preset ficam ativas e com nome e descrição novos. Uma de preset que estava
  arquivada volta.
- Os nomes também são trocados em `months.topics_snapshot`, para os meses passados mostrarem
  "Prazeres e Confortos" e não "Diversos".
- **Categorias criadas pela pessoa são excluídas.** O dono acredita que nenhuma conta tem uma, mas
  a migração precisa ser segura caso tenha:
  - Os gastos, rendas direcionadas, modelos de Contas do mês e parcelamentos que apontam para
    elas passam para **Prazeres e Confortos**.
  - A categoria sai de `topics`, de `topics_snapshot` e do `carry_in`. A sobra dela, se houver,
    soma na sobra de Prazeres e Confortos.
  - Registre no log quantas categorias e quantos lançamentos foram movidos, como a migração de
    Custos Fixos faz.
  - Esse caso tem que ter teste.
- Se a % das 4 não fechar 100% depois de tirar as extras, a sobra vai para Prazeres e Confortos.

## Procure e troque "Diversos" em todo lugar

Faça `grep -rn "Diversos\|diversos"` e troque nos textos de interface, nos tours
(`lib/modules/tours.ts`), nos exemplos e comentários (`LancamentosScreen.tsx`,
`lib/budget/feedback.ts`, `lib/banks/review.ts`), nas mensagens do autoteste
(`lib/server/selfTest/checks/month.ts`, como "A categoria Diversos sumiu do resumo do mês"), nos
testes e no README. No código, o identificador `'diversos'` do preset fica como está.

O autoteste que salva as categorias sem Diversos e confere que ela foi mantida arquivada
(`month.ts`, por volta da linha 144) precisa mudar. A nova expectativa é que ela continue ativa,
porque o servidor não deixa nenhuma das 4 sair.

## README

Reescreva a seção **Categorias**: são sempre 4, com nomes fixos, e a pessoa só ajusta a % e a
cor. Tire "Criar é possível, mas desaconselhado", "Nunca se exclui, só se arquiva" e "Restaurar
categorias padrão", e diga que "Custos Fixos e Imprevistos" continuam como estão. Atualize os
exemplos com "Diversos" no resto do README.

---

# Parte 2: tags nos gastos e nas rendas

## A regra que não pode quebrar

**Tag não muda nenhum número.** Categoria (`categoryKind` + `topicId`) decide de qual limite o
gasto sai, entra no "posso gastar", nas sobras, no rateio dos custos fixos, no fechamento do mês,
na fatura e no histórico. A tag não entra em nada disso. Nenhum arquivo de `lib/budget/` que
calcula valores (`calculations.ts`, `rollover.ts`, `cards.ts`, `bill.ts`, `cash.ts`,
`installments.ts`, `recurring.ts`, `reserve.ts`) pode ler tags. Escreva um teste que prove isso:
o mesmo mês com e sem tags nos lançamentos dá exatamente os mesmos totais.

## Objetivo e como saber que deu certo

1. **Marcar:** no formulário de gasto (`components/month/ExpenseFormSheet.tsx`) e no de renda
   (`components/month/IncomeFormSheet.tsx`), a pessoa toca em uma ou mais tags (chips, com o
   `Chip` que já existe) ou cria uma nova ali mesmo ("+ Nova tag"), sem sair do formulário. O
   campo é opcional e fica depois dos campos principais, para não atrapalhar o lançamento rápido.
2. **Filtrar:** em Lançamentos (`components/screens/LancamentosScreen.tsx`):
   - Aba **Gastos**: a folha "Filtrar gastos" ganha uma seção **Tags** abaixo das categorias.
   - Aba **Renda**: ganha o botão **Filtrar** (hoje não tem), só com as tags de renda.
   - Os chips do filtro ativo mostram as tags escolhidas, do mesmo jeito que as categorias.
   - A linha "N gastos · R$ X" que já existe passa a responder a pergunta do dono: filtrou por
     **Mercado**, ela mostra quanto foi gasto no mercado naquele mês.
   - Lógica do filtro: dentro das categorias é "ou" (como hoje), dentro das tags também é "ou", e
     entre categorias e tags é "e". Exemplo: "Prazeres e Confortos" + "Restaurante" mostra só os
     gastos de Prazeres e Confortos com a tag Restaurante.
   - A busca por texto também acha o lançamento pelo nome da tag.
   - O filtro de tag vai junto quando a pessoa troca de mês deslizando: ela quer comparar o
     mercado de outubro com o de novembro.
3. **Ver:** cada linha da lista mostra as tags do lançamento em pílulas pequenas, depois da
   categoria (`5 nov · Prazeres e Confortos · Mercado`). Se forem muitas, mostre as duas primeiras
   e "+N". O nome da categoria ficou mais longo, então confira que a linha não quebra mal no
   celular (cerca de 360 px).
4. **Editar as tags:** criar, renomear, trocar a cor e apagar.
   - Onde: na engrenagem de Lançamentos (`ModuleSettingsSheet module="expenses"`, hoje só com
     `CategoriesSettings`), numa seção **Tags** com duas listas, **de gasto** e **de renda**, e
     também por um "Editar tags" dentro do campo de tags do formulário.
   - Renomear muda o nome em todos os lançamentos, porque eles guardam o id, não o texto.
   - Apagar pede confirmação ("Apagar a tag Mercado? Ela sai de 12 lançamentos. Os valores não
     mudam.") e tira a tag de todos os lançamentos, modelos e parcelamentos na mesma transação.
     Ofereça "Desfazer" no toast.
5. **Entender a diferença:** uma linha só, visível na seção Tags e no campo de tags na primeira
   vez (aviso de uma vez, guardado em `dismissed_notices` como os outros):
   > **Categoria** é uma das suas 4 metas e decide de onde sai o dinheiro. **Tag** é só um rótulo
   > para você achar depois.

   O resto da explicação vai num ⓘ. O campo de tags nunca usa a palavra "categoria" e o campo de
   categoria nunca usa a palavra "tag". Use visual diferente também: tag em pílula com `#` ou
   ícone de etiqueta (`Tag` do lucide-react), categoria com a cor dela como hoje.

## Decisões já tomadas

- **Duas listas separadas**: tags de gasto e tags de renda. Uma tag de gasto não aparece no
  formulário de renda, e vice-versa.
- **Várias tags por lançamento**: até 10. O nome tem de 1 a 30 caracteres e não pode repetir na
  mesma lista, ignorando maiúsculas e acentos ("mercado" = "Mercado"). Cada lista aceita até 100
  tags. Uma tag não pode ter o mesmo nome de uma das 4 categorias, para não confundir.
- **Conta nova começa sem tags.** Com a lista vazia, o campo sugere com um toque: Mercado,
  Restaurante, Viagem (gasto) e Trabalho, Bico (renda). Tocar numa sugestão cria a tag e já marca.
- **Funciona em mês fechado.** Como o "Já me pagou" (`setReimbursed` em
  `lib/server/budgetRepository.ts`), pôr ou tirar uma tag é permitido num mês fechado, porque não
  muda nenhum número. Crie uma operação própria (por exemplo `setEntryTags(month, kind, id,
  tagIds)`), em vez de passar por `saveExpense`/`saveIncome`, que recusam mês fechado. No
  formulário de um mês fechado, só o campo de tags fica editável.
- **Contas do mês e parcelamentos herdam.** O modelo recorrente (`recurringExpenses`) e o plano
  de parcelas (`installments`) também guardam tags. O gasto lançado a partir deles nasce com as
  mesmas tags (a Netflix já sai com "Assinatura", cada parcela da TV com "Casa"). Mudar a tag do
  modelo não reescreve os gastos já lançados.
- **Fora do escopo:** limite ou meta por tag, gráfico por tag no Histórico, tag nos lançamentos
  vindos da revisão de Bancos (`BankReviewScreen`). Esses lançamentos nascem sem tag e a pessoa
  edita depois. Também não precisa de missão nova.

## Onde mexer

- **Tipos** (`lib/budget/types.ts`): `Tag { id; name; kind: 'expense' | 'income'; color?;
  order }`, `BudgetSettings.tags?: Tag[]`, `Expense.tagIds?: string[]`, `Income.tagIds?:
  string[]`, e o mesmo em `RecurringExpense` e `InstallmentPlan`.
- **Banco** (`lib/server/db/schema.ts`): coluna `tags` jsonb em `budget_settings` (default `[]`,
  como `topics`), e `tag_ids` (`text[]` ou jsonb, default vazio) em `expenses`, `incomes`,
  `recurring_expenses` e `installments`. Gere a migração com `npm run db:generate`. A Parte 1 não
  deve precisar de migração de schema, só da migração de dados em `job_runs`. Se precisar, a de
  tags vem depois dela.
- **Validação** (`lib/server/validation.ts`): `tagIds` opcional em `incomeSchema`,
  `expenseSchema`, `recurringExpenseSchema` e `installmentPlanSchema`, e `tags` no
  `settingsSchema`, com os limites acima. O servidor descarta ids que não existem na lista daquele
  tipo, para uma tag de renda nunca parar num gasto.
- **Repositório e API**: `lib/server/budgetRepository.ts` (ler e gravar `tag_ids`, a operação de
  mês fechado e o apagar em transação), `lib/storage/repository.ts`, `httpRepository.ts`,
  `walletHttpRepository.ts` e as rotas em `app/api/v1/`. Ao lançar a partir de um modelo
  (`lib/server/recurringBills.ts`) ou de um parcelamento, copie as tags.
- **Backup** (`lib/storage/repository.ts`): `BACKUP_VERSION` passa para 4. Backups 1–3 continuam
  sendo importados, sem tags e passando por `enforceFixedTopics` (Parte 1). O
  `IndexedDbBudgetRepository` só importa dados antigos: basta não quebrar.
- **Tour** (`lib/modules/tours.ts`): um passo curto no filtro de Lançamentos, mostrando que dá
  para filtrar por tag.
- **Autoteste** (`lib/server/selfTest/checks/month.ts`): um check que põe tags num gasto de mês
  fechado e confere que nenhum total mudou.
- **README**: uma seção **Tags** logo depois de "Categorias", dizendo a diferença em uma frase, e
  as regras acima (duas listas, mês fechado, herança, apagar).

---

## Testes (vitest)

**Parte 1**
- `enforceFixedTopics`: lista com categoria extra, com preset arquivado, com nome trocado, com
  descrição trocada e com ordem trocada. Em todos os casos sai com as 4 certas, mantendo ids e %.
- Salvar configurações com uma categoria nova ou com um nome diferente não muda nada além de %
  e cor.
- Migração: uma conta com categoria extra que tem gastos, renda direcionada, modelo e sobra. Tudo
  vai para Prazeres e Confortos e os totais do mês não mudam. Rodar a migração de novo não faz
  nada.
- Conta nova nasce com "Prazeres e Confortos", e os meses passados mostram o nome novo.

**Parte 2**
- Os cálculos do mês são idênticos com e sem tags. Este é o teste da regra principal.
- O filtro: "ou" dentro das tags, "e" com as categorias, total certo, e busca pelo nome da tag.
- Renomear a tag reflete em todos os lançamentos. Apagar remove a tag de todos, e o "Desfazer"
  devolve.
- Pôr tag em mês fechado funciona, e editar valor em mês fechado continua sendo recusado.
- Gasto lançado de um modelo ou de um parcelamento herda as tags.
- Uma tag de renda enviada num gasto é descartada pelo servidor.
- Um backup v3 importa sem erro, e o export v4 volta igual depois de importado.

Antes de cada commit, rode `npm run lint`, `npm test` e `npm run build`. No fim, teste no
navegador:

1. A engrenagem das categorias mostra só as 4, sem criar, arquivar ou renomear, e com
   "Prazeres e Confortos".
2. Crie a tag Mercado e lance três gastos com ela em categorias diferentes.
3. Filtre por Mercado e confira que o total mostrado é a soma dos três.
