# Capital

Aplicativo web mobile-first de orçamento doméstico por categorias (cada uma com
um percentual da renda definido pelo usuário), substituindo uma planilha. Renda, gastos, custos
fixos e imprevistos são lançados manualmente; o app calcula quanto ainda pode
ser gasto em cada categoria, descontando o rateio dos custos fixos/imprevistos e
carregando a sobra de um mês para o outro quando o mês é fechado (rollover). Gastos marcados como "feitos no
cartão" entram na fatura do cartão, além de contarem no orçamento normal da categoria em que
foram lançados — e **fatura e orçamento são coisas separadas** (veja o módulo Cartão).

PWA instalável, com **login por e-mail e senha**. Os dados ficam num **PostgreSQL próprio no
Orange Pi**, sem serviço de banco na nuvem: o navegador só fala com a API do próprio app, que
grava no banco sempre em nome do usuário logado. Cada conta só enxerga os próprios dados. Sem
conexão o app abre, mas as telas ficam carregando até a rede voltar.

### Palavras da interface

A interface usa palavras do dia a dia (só o texto muda; código, colunas e rotas continuam como
estavam): nem a tela Categorias nem o card da Início somam as categorias num "Ainda posso
gastar" ou num total "Para as categorias" — um total parecia dinheiro livre para gastar com tudo;
o topo das Categorias mostra só **Renda** e **Total gasto**, e cada categoria tem o seu **Limite**
e a **Sobra**.
Também: "na fatura de"/"no mês de" (nunca "competência"), **Falta para a reserva** (ou "Reserva
completa ✓"), **Meta da reserva**, **Dentro do planejado**, **Guardar / Retirar** (reserva
investida), **devolução**, **sem categoria** (a parte da reserva investida fora das categorias da
reserva), **dividido entre as categorias** e **telas** (as áreas de trabalho da Início).

**Pouco texto.** Por tela, no máximo uma linha curta de ajuda visível; o resto vai para um ⓘ ou
sai. Dica de tour, uma linha. Mensagens de erro curtas ("Não foi possível salvar. Tente de novo.").
Em outubro de 2026 os textos de interface com 60 caracteres ou mais caíram de 205 para cerca de 20
de verdade (sobram os avisos de novidade antigos).

### Módulos: todo mundo tem todos

**Tudo o que o app faz é um módulo**, e **todo módulo está sempre ligado** para todo mundo: não
existe ligar nem desligar (a tela Módulos saiu; `/modulos` abre a Início). Quem não tem cartão tem
o módulo Cartão do mesmo jeito, com a tela vazia e um botão para cadastrar. A única exceção são os
**módulos restritos** (abaixo), que só as contas com acesso têm.

**Primeiro acesso.** A conta nova abre direto na Início, montada como a **conta modelo** (abaixo),
com o widget **Missões** no topo (veja "Missões e XP", abaixo): cada missão é um botão que leva ao
lugar certo. As perguntas das categorias abrem na primeira visita a Categorias.

**Conta modelo da Início** (`lib/server/homeTemplate.ts`). `HOME_TEMPLATE_EMAIL` e
`HOME_TEMPLATE_PASSWORD` no `.env` configuram uma conta só para isso: ela é criada no primeiro login
(já confirmada, como a conta de teste) e **como o dono arrumar a Início dela** — telas, ordem e
tamanhos — é a Início de **toda conta nova** e o "Voltar ao padrão" da bandeja de widgets, **sempre
com todos os widgets**: no padrão só fica de fora o widget de um módulo restrito, para quem não tem
acesso (o que a conta modelo tirar não vale para as outras). Ela vê todos os módulos (para dar para
pôr qualquer widget), não ganha XP e não aparece na Administração. Sem ela, vale a Início do dono
(`OWNER_EMAIL`). Mudar a conta modelo só muda as contas novas.

**Na atualização que tirou o liga/desliga** (`lib/server/modulesAlwaysOnMigration.ts`, uma vez só,
marcada em `job_runs`): todas as contas, menos a do dono e a modelo, receberam a Início do modelo
com todos os widgets (e Missões no topo). Daí em diante cada um muda e tira o que quiser.

A ficha de cada módulo (nome, explicação, grupo, dependências, tela e card do Início) fica escrita
uma vez em `lib/modules/catalog.ts`. A bandeja de apps e a Início leem dela. Os ícones e os cards
ficam em `components/modules`.

**Dependências.** Alguns módulos são construídos em cima de outro, o que só importa para os
restritos: se Lançamentos for restrito, tudo o que depende dele some junto.

- Lançamentos
  - Gastos por categoria
    - Histórico e gráficos
  - Cartão
  - A receber
  - Contas do mês
- Reserva, Open Finance, Diagrama e Lembretes não dependem de nenhum.

**Módulos restritos.** O dono do servidor (`OWNER_EMAIL`) escolhe em **Administração**, no card
"Módulos restritos", quais módulos ficam só para as contas com acesso: um switch **"Restrito"** por
módulo. A escolha fica no banco (`module_access`, uma linha por módulo que o dono mexeu); um módulo
sem linha segue o padrão do catálogo (`vipByDefault`), que é **Open Finance**. As contas com acesso ficam em `vip_users` (o dono e a conta modelo sempre têm). No código e
no banco o acesso ainda se chama "vip"; na tela, é "Restrito" e "Acesso aos restritos".

- **Quem não tem acesso não fica sabendo que o módulo existe.** Ele some da bandeja de apps (e o
  grupo que fica vazio some junto), da bandeja de widgets, da política de privacidade
  (`/privacidade`, que lê quem está vendo) e das perguntas automáticas do Diagrama (Graham, P/VP); o
  endereço do módulo mostra só "Página não encontrada" (`ModuleGate`). Um módulo que depende de um
  restrito some do mesmo jeito (`isModuleHidden` em `lib/modules/flags.ts`).
- **Virou restrito:** o módulo some para todas as contas sem acesso, junto com os que dependem
  dele, e nenhum dado é apagado (`setModuleVip` em `lib/server/adminRepository.ts`). Se alguém sem
  acesso usa o módulo, a Administração pede confirmação dizendo quantas contas são.
- **Deixou de ser restrito:** volta na hora para todo mundo.
- **Uma conta ganha ou perde o acesso:** os módulos restritos aparecem ou somem na hora, com os
  dados guardados.
- O que cada conta tem fica salvo em `budget_settings.modules` (`effectiveModules`: tudo, menos o
  restrito sem acesso), que é o que os jobs leem; `syncModules` regrava isso a cada subida do
  servidor e a cada mudança de acesso. Nas leituras e gravações das configurações e na importação
  de backup, `withAccessRules` troca o que veio pelo que a conta tem. As rotas de Open Finance
  e das perguntas automáticas respondem **404 "Não encontrado."** a quem não tem acesso, sem o
  nome do módulo (`requireNotVipLocked` em `lib/server/access.ts`). O app recebe a lista no layout
  (`vipModules` do `AuthUser`) e usa `mayUseModule` e `isModuleHidden`.

### Missões e XP

**Missões** (`/missoes`, `lib/gamification`) é o módulo que dá vontade de voltar: tarefas pequenas
que dão XP, e o XP sobe o nível. A regra do dono: **XP nunca vem de mentira**. Por isso uma missão
premia **usar** o app (abrir, anotar, conferir) e nunca um **resultado** (quanto investiu, meta
batida, quanto sobrou), que depende do que a pessoa digita e do mês que ela teve. Cada missão dá um
XP fixo, seja qual for o valor, e vale **uma vez por período** pela data do servidor (São Paulo):
lançar 50 gastos dá o mesmo que lançar 1, e apagar não tira nem devolve o XP. Não há ranking nem
prêmio. O catálogo (`MISSIONS` em `lib/gamification/missions.ts`) é feito para mudar.

| Quando | Missões |
| --- | --- |
| Todo dia | Resgatar o XP do dia (10, no botão "Resgatar" da faixa das Missões na Início; só abrir o app não dá) |
| Toda semana | Conferir os bancos (15, só quem tem Open Finance e um banco) |
| Todo mês | Registrar uma renda (30), Lançar um gasto (30), Conferir o calendário, as contas do mês, a fatura e a reserva (15 cada; contas e fatura só para quem tem conta ou cartão), Fechar o mês anterior (50) |
| Uma vez | Primeira renda e primeiro gasto (50 cada), Ajustar as categorias (50), Primeiro lembrete, Ligar as notificações e Instalar o app (30 cada), Conectar um banco (100, Open Finance), e Conhecer cada módulo (20 cada: a primeira visita à tela; A receber, o primeiro uso) |

Missão de módulo restrito só existe para quem tem acesso.

**Níveis** (`lib/gamification/levels.ts`): uma árvore que cresce, para não ter nome com gênero —
Semente, Broto, Muda, Arbusto, Árvore, Árvore florida, Árvore com frutos, Pomar, Bosque e
Floresta (0, 150, 400, 800, 1.400, 2.200, 3.300, 4.800, 6.800 e 9.500 XP).

**Como conta.** O XP fica em `xp_events` (uma linha por missão e período; a chave primária é o que
garante "uma vez"). `POST /api/v1/missions` confere o que os dados da conta mostram (renda, gasto,
lembrete, cartão, push, banco, mês anterior fechado...), grava o que a conta acabou de fazer e
devolve o nível, as missões e o XP dos últimos meses. As missões de "ir até o lugar" chegam do app
(`visitsForPath`: a tela de cada módulo, Contas do mês, Cartão, Reserva, a conferência dos bancos e
a aba Calendário) e só valem para uma missão que a conta tem. O `MissionsProvider` confere ao abrir
o app, ao voltar para ele, a cada tela, no "Resgatar" (`claimDay`, a missão do dia, que guarda a
chave antiga `open-app`) e logo depois de qualquer gravação (`capital:data-changed`, disparado pelo
`apiClient`). O que acabou de ganhar **voa até a árvore** da faixa da Início quando ela está na
tela (`components/missions/xpFlight.ts`): o "+30 XP" sai de onde a pessoa tocou (o Resgatar, o
Salvar), faz uma curva com umas faíscas atrás e entra na árvore, que pula; a barra só enche quando
ele chega. Fora da Início, com uma folha por cima ou com "menos movimento" no aparelho, aparece num
aviso ("+30 XP · Lançar um gasto"), que espera o destaque de uma missão sair da tela. Um nível novo
aparece num cartão com a árvore e o nome, depois que o XP chegou. Conta antiga ganha de uma vez o XP do que já tinha feito,
com um aviso só ("Você já tinha 340 XP · Muda"). "Apagar todos os dados" zera o XP.

**Faixa e tela.** A faixa fica no topo da Início, embaixo da saudação (não é widget): a árvore e o
nome do nível, a barra até o próximo e a próxima missão (primeiro as de primeira vez, depois as do
mês) e, enquanto o XP de hoje não foi resgatado, o botão **Resgatar** (+10 XP) à direita. A
boas-vindas da conta nova aparece uma vez só (aviso `welcome:missions`). A tela tem o nível em
destaque, as missões por período ("Conhecer os módulos" recolhido) e o XP de cada mês. Tocar numa
missão leva ao lugar e destaca o único botão a tocar (um passo do spotlight, que o próprio toque no
botão fecha); renda e gasto abrem o formulário ali mesmo na Início. Nada disso abre sozinho.

**Dinheiro do mês**

- **Lançamentos** (`/mes/[mês]/lancamentos`) — gastos e rendas do mês com busca, abas por
  categoria, "Lançar gasto", "Renda" e "Apagar dados do mês". Sem ele não existe formulário de gasto.
  **Custos Fixos e Imprevistos ficam na mesma aba**: são as duas categorias sem meta própria, as
  duas rateadas entre as categorias, e separá-las só obrigava a adivinhar em qual das duas o gasto
  tinha sido lançado; cada linha diz qual das duas é.
- **Gastos por categoria** (`/mes/[mês]/categorias`) — metas em % da renda, "posso gastar", sobra
  por categoria, custos fixos e imprevistos com o rateio, e "Fechar mês". **A sobra só passa para o
  mês seguinte com o mês fechado.** Enquanto houver mês anterior aberto, o widget e o topo da tela
  mostram "Fechar outubro" e, com mais de um aberto, "Fechar todos os meses anteriores"; ao fechar, o
  app pergunta se o que restou vem para o mês atual. Reabrir um mês devolve a sobra para ele até
  fechar de novo. Detalhe da categoria em
  `/mes/[mês]/categoria/[id]`. Desligado, o gasto continua sendo lançado numa categoria (que segue
  editável na engrenagem de Lançamentos, com nome, descrição e cor), mas somem as metas, o
  percentual e a regra dos 100%. As regras das categorias estão em "Categorias" logo abaixo.
- **Cartão** (`/cartao`) — tudo do cartão num módulo só: a pergunta "A compra foi no cartão?", os
  cartões cadastrados, o parcelamento e a fatura de cada mês. Desligado, a pergunta some; gastos
  antigos marcados no cartão continuam marcados. A tela tem três abas, no jeito de um app de
  banco, e está detalhada em "O módulo Cartão" logo abaixo.
- **A receber** — dinheiro que saiu por outra pessoa, que vai devolver. **Não** entra em nenhuma
  categoria, no rateio dos custos fixos nem no gasto do mês, e **não precisa ser no cartão**:
  emprestar R$ 50 em dinheiro é a mesma coisa — por isso o módulo só precisa de Lançamentos, e não
  do Cartão —, e a pergunta "a compra foi no cartão?" fica
  livre como em qualquer outro gasto — foi no cartão, entra na fatura (`cardTotal` e
  `reimbursableTotal`); não foi, é só um valor que alguém te deve. Tem uma aba em Lançamentos,
  dividida em **"Ainda devem"** e **"Já me pagaram"**, com o total de cada lado: um toque no
  círculo de cada linha marca quem pagou (`expenses.reimbursed_at`). A marca não mexe em número
  nenhum — o dinheiro saiu de qualquer jeito e nunca consumiu categoria —, ela só tira a linha do
  que ainda é seu a receber, e é esse valor que o card do Início mostra.
- **Histórico e gráficos** (`/historico`) — aba **Gastos**: o gasto de cada mês contra a sua média e a renda (toque numa barra para trocar de mês), as categorias do mês e cada categoria mês a mês (gasto × limite ou sobra). Com o **Diagrama** ligado, aba **Investimentos**: a subida e a descida da carteira em 1M/6M/1A/5A, por tipo e por ativo — a carteira de hoje aos preços de cada dia (Yahoo, grátis e sem token, em `price_history_cache`); sem as cotas, cada ativo conta igual.

**Carteira** (cada um com tela própria; o antigo painel `/carteira` redireciona para o Início):
  - **Contas do mês** (`/carteira/recorrentes`; o antigo "Gastos recorrentes") — as contas de todo
    mês (aluguel, luz, internet) como uma lista do mês na tela: no topo, **"Falta lançar R$ 640"**
    com a barra de quantas já foram (ou **"Tudo lançado ✓"**); embaixo, o que falta, a próxima a
    vencer primeiro ("vence dia 10", "vence hoje", "venceu dia 5" em vermelho), e as **Já
    lançadas**, com o dia. O mês troca deslizando, como na fatura do Cartão. Cada conta pode ter um
    **dia do vencimento** (`recurring_expenses.due_day`, 1–31, 29–31 caem no último dia dos meses
    curtos), opcional como tudo: "Não informar" é a primeira opção.
    "Lançar" abre o **mesmo formulário de gasto de sempre**, já preenchido e com a data de hoje, no
    mês que está na tela — inclusive com "À vista / Parcelado" quando a conta é paga no cartão,
    porque lançar é lançar uma compra nova como qualquer outra. O gasto salvo aponta para a conta
    (`expenses.recurring_id`; numa compra parcelada, `installments.recurring_id`, contada no mês da
    compra), e é **só isso** que marca a conta como lançada: nada fica guardado à parte, então
    apagar o gasto devolve a conta para a lista. Tocar numa conta que falta abre **Lançar**, **Já
    lancei este mês** (escolhe, entre os gastos do mês, o que foi essa conta — os da mesma categoria
    primeiro — e liga os dois) e **Editar conta**. Os gastos lançados de um recorrente antes disso
    existir foram ligados uma vez, na subida (`lib/server/recurringLaunchLink.ts`), só onde não havia
    dúvida: mesma descrição e mesma categoria de uma conta só.
    **Aviso no celular** (`lib/server/recurringBills.ts`): no dia do vencimento, no horário escolhido
    na engrenagem (padrão 09:00), e, com "Lembrar de novo até lançar", uma vez por dia por até 3
    dias depois, enquanto a conta não for lançada. A notificação traz **Lançar ✅**, que lança a conta
    como ela é sem abrir o app (token assinado, como o "Fatura paga"; duas vezes é uma só), menos a
    parcelada, que precisa do formulário. Só avisa das contas com dia do vencimento, e a categoria
    "Contas do mês" pode ser desligada na Central de notificações.
    **A própria conta pode ser parcelada**: marcando "Esse gasto é pago no cartão?", o formulário
    pergunta "Como você paga?" e guarda em quantas vezes e como entra no orçamento
    (`recurring_expenses.installment_count` e `installment_accounting`). Não guarda data: a
    primeira cobrança vem do cartão no dia do lançamento. Aí "Lançar" já abre em "Parcelado", com
    o número de vezes preenchido, e salvar cria a compra parcelada. Tirar o cartão da conta
    apaga o parcelamento dela, porque parcelar só existe no cartão.
  - **Reserva** (`/carteira/caixa`) — um módulo só para o que eram dois, "Reserva de emergência" e
    "Reserva investida": para a pessoa é uma coisa só, a reserva dela. A tela tem duas abas,
    **Emergência** e **Investida** (`?aba=investida`; o antigo `/carteira/reserva` leva para lá), e
    a engrenagem junta o que era das duas (reserva em conta, custos, meses da meta e o ativo). Quem
    tinha a investida ligada passou a ter a Reserva ligada, com o widget no mesmo lugar da Início
    (`migrateReserveModule` em `lib/modules/migration.ts`, uma vez na subida; o servidor também
    aceita a chave antiga de um backup ou de um app em cache).
    - **Investida** — no topo, o valor das cotas, com **Guardar / Retirar** em destaque; a cotação e
    o "Atualizar" ficam embaixo. São cotas de um ativo (AUPO11 por padrão) divididas em categorias da
    reserva, cada uma ligada a uma categoria do orçamento — guardar lança gasto, então essa parte
    precisa de Lançamentos; sem ele, a aba mostra as cotas e deixa comprar ou vender. **Remanejar vai nos dois sentidos**:
    *Guardar* compra cotas para a categoria da reserva e lança o gasto na categoria do orçamento;
    *Retirar* faz o caminho de volta — as cotas voltam para a reserva livre e a categoria do
    orçamento recebe um **estorno** (um lançamento negativo, "AUPO11 (retirada)"), para o mês não
    continuar mostrando um gasto que a pessoa desfez. Nenhuma categoria entrega mais cotas do que
    tem. Tudo na mesma transação. A cotação é grátis e sem token (`lib/server/quotes.ts`): vem da própria B3
    (`cotacao.b3.com.br`, com uns 15 min de atraso) e, se ela falhar, do Yahoo Finance; fica em
    cache e se atualiza sozinha ao abrir a Carteira quando tem mais de 15 min. Nenhuma das duas é
    uma API documentada com garantia, por isso há duas e o app nunca depende de uma resposta ao
    vivo para abrir a tela.
    - **Emergência** — no topo, o número da tela: "R$ 8.000 de R$ 12.000" (a reserva já
    sem as dívidas, contra a meta), com barra e "Faltam R$ 4.000" ou "Reserva completa ✓"; reserva
    em conta, investida sem categoria, dívidas e meta ficam em "Ver detalhes", e o texto do plano
    vira uma linha com ⓘ. A dívida do cartão é a soma das faturas **em aberto** (de
    todos os cartões e competências, inclusive a "Não informado"); a dos parcelados é só o que cai
    **depois** da competência corrente, então cada real é contado uma vez.
    **O plano da reserva** (`lib/budget/reserve.ts`) mora nesta tela, que é onde aparece o quanto
    falta: um imprevisto grande — R$ 5.000 de saúde para quem ganha R$ 3.000 — não cabe no mês em
    que acontece, sai da reserva, e é a reserva que fica no vermelho. Com o gap negativo a tela
    oferece **montar um plano**: quanto recompor e em quantos meses ("R$ 5.000 em 10 meses =
    R$ 500 por mês"), com espaço para dizer o que abriu o buraco. Todo mês o card mostra o
    progresso e um botão que lança a parcela: o valor vira um gasto **"Recompor a reserva"** na
    competência, como **imprevisto** (é o que ele é — recompor não é investir, que é dinheiro com
    objetivo de longo prazo; a categoria vem marcada como **Recomendado** e pode ser trocada). O
    plano **não mexe no saldo da reserva**: onde o dinheiro recomposto fica — na conta ou em cotas
    — não muda nada do que ele acompanha, e continua sendo a pessoa quem diz, na reserva em conta e
    nas cotas. O plano guarda só o que ela decidiu: quanto já voltou, quanto falta e
    quantos meses restam vêm sempre da soma das parcelas lançadas, então pular um mês adia o plano
    em vez de quebrá-lo, e duas parcelas no mesmo mês somam. Desistir do plano não apaga os gastos
    já lançados — o dinheiro voltou mesmo para a reserva.

### O módulo Cartão

Tudo o que é cartão vive em `/cartao`, em três abas — a **Fatura** olha um mês por vez, os
**Parcelados** olham os meses à frente e **Cartões** cuida dos cartões em si.

**Fatura × orçamento.** São contas diferentes, e misturá-las era a origem dos erros:

- **Fatura** é o que o banco cobra na competência. É **sempre a parcela** — uma compra em 1× é o
  caso de uma parcela só. A conta está em `lib/budget/bill.ts`: os gastos no cartão daquela
  competência que não vieram de um parcelamento, mais as parcelas com linha naquele mês
  (respeitando um ajuste feito na mão), mais as parcelas cobradas ali que ainda não têm linha
  (mês que ninguém abriu, ou parcelamento "à vista"), menos o gasto único de um "à vista".
- **Orçamento** é o que consome categoria, e quem manda nisso é a forma de contabilizar a compra.

**Lançar um gasto.** O botão "Cartão" ao lado do valor (rótulo acessível "A compra foi no
cartão?") tem borda e cor normais, para não passar despercebido. Salvar um gasto novo mostra o que
ele fez com a categoria, com **Desfazer** (`expenseFeedback` em `lib/budget/feedback.ts`): "R$ 45,00
em Prazeres e Confortos · ainda dá R$ 320,00 este mês", ou "passou R$ 30,00 da meta"; custos fixos e
imprevistos falam do total, e A receber e Fora do orçamento dizem que não mexem em categoria. Um
gasto sem descrição leva o nome da categoria. A receber e Fora do orçamento, ao serem escolhidos,
mostram uma linha curta (com o "Não recomendado") e o resto atrás de um ⓘ.

**Parcelar ao lançar o gasto.** Marcando "A compra foi no cartão?" e escolhendo o cartão, o
formulário pergunta como você pagou: `À vista` ou `Parcelado`. Parcelado pede em quantas vezes
(2 a 120) e a primeira cobrança (já preenchida com o próximo vencimento do cartão), usa **a
categoria que você escolheu no formulário** e oferece as duas formas de entrar no orçamento — que
nunca se chamam "à vista", palavra que fica só para o pagamento:

- **Contar tudo neste mês (recomendado)** — o gasto inteiro conta na categoria no mês da compra;
  nos meses seguintes só a parcela aparece na fatura.
- **Contar uma parcela por mês** — a parcela de cada mês conta na categoria daquele mês e aparece
  nos lançamentos dela, inclusive nos meses que ainda não foram abertos.

Em vez de frases, uma prévia mostra o resultado: "Na fatura 10× R$ 87,24", a faixa dos meses
("out/26 ▸ nov ▸ dez ▸ … ▸ jul/27") e o que a categoria recebe ("R$ 872,40 em out/26" ou "R$ 87,24
por mês"). Internamente os modos continuam `upfront` e `installment`.

`1 vez` não cria parcelamento: vira um gasto comum.

**Uma compra parcelada que já vinha sendo paga.** O **+** da aba Parcelados abre o mesmo
formulário da compra, vazio, e aceita uma primeira cobrança **no passado** — é assim que entra um
parcelamento de antes do Capital. Quando alguma parcela já caiu, o formulário para e pergunta o
que fazer com ela:

- **Começar a contar de agora (recomendado)** — as parcelas já pagas ficam **fora de tudo**:
  nenhum gasto, nenhuma fatura e nenhuma dívida nos meses que já passaram, que continuam com os
  números que têm. Só o que falta aparece. Como parte da compra já foi paga, a forma de
  contabilizar fica travada em **contar uma parcela por mês**: contar tudo de uma vez teria de
  lançar a compra inteira no mês em que ela foi feita, que é o passado que a pessoa pediu para não
  mexer.
- **Lançar tudo retroativo** — todas as parcelas entram nos meses em que caíram, **nos meses que
  já existem no app**; um mês fechado impede o cadastro, como em qualquer outra edição.

No banco isso é `installments.paid_count`: as `paid_count` primeiras cobranças simplesmente não
existem para o app (`activeChargeRange` em `lib/budget/installments.ts`), nem na fatura, nem no
orçamento, nem na dívida, nem na conta de quais meses a compra toca.

**Adiantar parcelas.** Cada compra em andamento tem **"Adiantar parcelas"**, para quando a pessoa
paga antes da hora — e, porque quase sempre há abatimento, o app **pergunta se teve desconto** em
vez de deixar a compra parecer mais cara do que foi. Escolhendo quantas parcelas foram adiantadas
(saem do **fim**, então a compra termina antes) e o desconto, o app mostra a conta pronta
("3× de R$ 87,24 = R$ 261,71 − R$ 50,00 de desconto · você pagou R$ 211,71") e, ao confirmar, faz
as duas metades numa transação só:

- as parcelas adiantadas saem do parcelamento (`installments.advanced_count`), então somem das
  faturas em que iam cair, da dívida e dos próximos meses; adiantando todas, a compra vai para os
  encerrados;
- o que foi realmente pago vira **um lançamento** na competência do pagamento, "Adiantamento ·
  *nome da compra*", na fatura do mesmo cartão. Contando **uma parcela por mês**, ele conta na
  categoria da compra, no lugar das parcelas que iam cair; contando **tudo no mês da compra**, ele
  entra como **Fora do orçamento**,
  porque a compra inteira já contou no mês em que foi feita e contar de novo seria cobrar duas
  vezes da mesma categoria.

O valor e o número de parcelas da compra **não** são reescritos: o que ela custou, custou, e mexer
neles mudaria o valor de cada cobrança.

**"Não informado".** O seletor de cartão sempre oferece **Não informar** — nada no Capital é de
preenchimento obrigatório. Essas compras formam a fatura **"Não informado"**, que funciona
**exatamente como a de um cartão**: fica como dívida até você tocar em **Fatura paga**, e
"Marcar como não paga" desfaz. **Nenhuma fatura sai sozinha no Capital**, nem essa: se você não
marcar, a de setembro e a de outubro aparecem somadas, cada uma na sua linha. A única diferença é
que ela não tem vencimento nem aviso no celular, porque não há data para avisar. No banco ela é a
constante `UNASSIGNED_CARD_ID` em `card_bill_payments.card_id`.

**Limite (opcional).** Preenchido no cartão, a aba Fatura mostra "R$ 3.480 de R$ 5.000
disponíveis" e uma barra, com `disponível = limite − faturas em aberto do cartão − parcelas
futuras dele`. Em branco, **nada** aparece.

**Mês fechado trava a compra inteira.** Uma compra parcelada com qualquer parcela em mês fechado
não pode ser criada, editada nem excluída: o app recusa a operação inteira, diz quais meses estão
no caminho e leva até eles, onde o "Reabrir mês" já existe. A recusa vale nos dois lados — o
formulário não deixa salvar e `saveInstallment`/`deleteInstallment` respondem 409. Editar **uma
parcela sozinha** num mês aberto continua liberado; tocar numa parcela pergunta antes se você
quer editar a compra toda ou só aquele mês.

**Vencimento.** Sempre calculado (`lib/budget/cards.ts`): o dia do cartão, no mês seguinte à
competência (ou no mesmo, se a pessoa escolher), caindo para o último dia nos meses curtos e, **se
cair em sábado ou domingo, passando para a segunda**, como no banco — o adiamento pode atravessar
o mês sem mudar a competência da fatura. Feriados não entram: precisariam de um calendário que o
app não tem. Excluir um cartão não apaga nada: as compras só perdem o vínculo e passam para a
fatura "Não informado".

**Avisos da fatura** (`lib/server/cardBills.ts`): um job por minuto, no mesmo motor dos lembretes,
avisa no celular com a antecedência escolhida em cada cartão (só no dia, 1, 2, 3, 5 ou 7 dias
antes), de novo no dia do vencimento e, enquanto a fatura não for marcada como paga, uma vez por
dia por até uma semana depois — tudo pela data já adiada do fim de semana. O horário e o "insistir
até marcar como paga" ficam na engrenagem da tela. A notificação traz o botão **Fatura paga ✅**,
que funciona sem abrir o app (token assinado, igual ao "Realizado" dos lembretes), e a categoria
"Cartões" pode ser desligada na Central de notificações. A fatura "Não informado" não avisa.

**Assistente**

- **Lembretes** (`/lembretes`), com notificação no celular (Web Push):
  - **Tipos:** uma vez (data e hora, com aviso antecipado opcional de 30 min, 1 hora ou 1 dia),
    tarefa do dia (aparece todo dia e avisa nos horários escolhidos até ser concluída; concluída,
    vai para o histórico), toda semana (vários dias) e todo mês (dia 29–31 cai no último dia dos
    meses curtos).
  - **Nada de horário fixo:** cada lembrete tem o seu horário, e cada pessoa escolhe em
    Configurações → Lembretes quando lembrar de novo o que não foi marcado como feito (padrão
    08:00, 12:00, 15:00 e 18:00; dá para desligar em geral ou em cada lembrete). O que ficou para
    trás continua avisando nos dias seguintes, como "atrasado desde dd/MM".
  - **Notificação:** o botão "Realizado ✅" funciona sem abrir o app (token assinado, 36 h), e as
    tarefas do mesmo horário vão numa notificação só. As regras são puras em `lib/reminders`.
  - **Telas:** Hoje (atrasados, hoje, tarefas e amanhã), Todos (por tipo, com histórico) e
    Calendário dos compromissos; card "Lembretes de hoje" no Início. No calendário, tocar num dia
    **com** compromisso abre o que tem nele; tocar num dia **livre** (de hoje em diante) abre o
    formulário de lembrete já naquela data — um dia que já passou não faz nada, porque não há o
    que lembrar.
- **Lançar por voz ou texto** — retirado em 28/10/2026, junto com o Monitor de Gmail ("não bate com
  a proposta do app"): saem o microfone, a leitura por IA (Whisper e Ollama) e as rotas `/api/v1/ai`.
  Os gastos lançados por ele continuam, com `source` `voice` ou `text`. As regras de achar uma
  categoria num texto, que a conferência do Open Finance usa, ficaram em `lib/categoryText`.
- **Monitor de Gmail** — retirado em 28/10/2026 ("não bate com a proposta do app"). As tabelas
  `gmail_*` ficaram no banco, sem uso, até esses dados serem apagados; "Apagar todos os dados"
  ainda apaga o que a conta deixou nelas. Onde uma conta antiga guardou `gmail` (telas da Início,
  widgets escondidos, a barra antiga), a chave é deixada de fora (`RETIRED_MODULES` em
  `lib/modules/migration.ts`); os alertas antigos continuam no histórico de notificações.
- **Open Finance** (`/bancos`, começa restrito): traz os bancos da pessoa pelo **Meu Pluggy**, grátis e
  só leitura, com a chave da própria pessoa, e serve **só para conferir** o que foi lançado no
  Capital: gastos, recebimentos e (no Diagrama) as quantidades de ações e cotas. Nenhum saldo,
  fatura, valor em aberto ou limite do banco aparece, a não ser os saldos das contas que a
  pessoa marca para a Reserva.
  - **Configuração em 4 passos**, uma linha e um botão cada, e o app guarda em que passo a pessoa
    parou:
    1. conectar os bancos em meu.pluggy.ai (o app abre o site);
    2. criar a chave no dashboard da Pluggy (o app abre; o aviso de "teste de 15 dias" fica atrás
       do ⓘ, porque não vale para uso pessoal);
    3. colar o Client ID e o Client Secret, que a Pluggy confere antes de salvar;
    4. **"Trazer um banco"**: o app manda a pessoa ao Meu Pluggy para escolher **um** banco e
       autorizar, e a Pluggy a devolve para `/bancos`.
  - **"Ver como fazer"** em cada passo abre, numa folha, um vídeo vertical sem som com as telas
    (`public/videos/open-finance/parte-N.mp4`, 720×1280, com legendas no próprio vídeo): o passo 1
    abre a parte 1, o 2 a parte 2, o 3 a parte 2 a partir de 0:49 (quando o Client Secret aparece)
    e o 4 a parte 3. As telas da Pluggy são recriadas, com e-mails e chaves de exemplo; o service
    worker não guarda vídeos.
  - **Chegada do banco:** ele aparece como "Chegando…" e a tela relê a cada 5 s até as contas
    chegarem (~2 min).
  - **Nome do banco:** o Capital sugere, pelo código do banco na conta ou pelo nome da conta, e a
    pessoa troca no lápis, onde também tira o banco.
  - **"Trazer outro banco"** mostra "3 de 5 conexões grátis". Uma autorização largada pela
    metade some sozinha depois que o link vence.
  - **Engrenagem:** a chave (o Secret só como "••••1234"), "Trocar a chave" e "Desconectar
    tudo". Desconectar tira os bancos da aplicação da pessoa na Pluggy e apaga a chave; os
    bancos continuam no Meu Pluggy.
  - **Tela dos bancos** (o Open Finance serve **só para conferir** o que foi lançado no Capital):
    - **nenhum saldo, fatura, valor em aberto ou limite** vindo do banco aparece, nem aqui nem na
      Início. O saldo só aparece na Reserva, nas contas que a pessoa marca;
    - no topo, **"Conferir com o Capital"**: "Conferir gastos" e "Conferir recebimentos" (com
      Lançamentos) e "Conferir investimentos" (com o Diagrama);
    - cada banco com "atualizado há 5 h" e as contas só com o nome e o tipo (conta, poupança,
      cartão);
    - "Buscar novidades" relê a Pluggy (não faz o banco mandar antes), até 6 vezes em 10 min.
  - **Avisos na tela:**
    - banco sem dados há mais de 48 h fica **"Parado"**, com "Reconectar no Meu Pluggy", mesmo
      com a Pluggy dizendo que está tudo bem;
    - 15 dias antes de a autorização vencer, aparece "A autorização vence em N dias", com
      "Renovar";
    - um banco que a Pluggy perdeu pede "Trazer de novo".
  - **Avisos no celular** (categoria "Open Finance" em Notificações, para quem pode usar o módulo):
    - **só quando a atualização traz algo para conferir**: depois de cada leitura com novidade
      (não a primeira, o ano de histórico), conta só o que é **novo nesta leitura e caiu em
      "Falta no Capital"** no mês atual ou no anterior, pelo mesmo cálculo da tela: "🏦 Nubank
      atualizou: 3 gastos e 1 recebimento para conferir." O que já confere (par forte, compra
      parcelada no Capital) e o que fica de fora não avisa. Sem nada para conferir, não avisa.
      Tocar abre a aba que tem mais coisa (no mês anterior, se tudo for dele). Nunca "agora";
    - banco **parado** (48 h) e autorização **vencendo** (15 dias) avisam uma vez cada;
    - na engrenagem: "Gastos para conferir", "Recebimentos para conferir" e **"Aviso
      silencioso"** (chega na central e na bandeja do celular, sem som nem vibração; vale também
      para banco parado e autorização). As escolhas antigas viram as novas: gastos = compras ou
      Pix enviados, recebimentos = Pix recebidos; o valor mínimo saiu. (Houve um aviso próprio
      do salário; o dono o tirou em 2026-10-20 por não ver utilidade.)
  - **Conferir o mês** (`/bancos/conferir`, precisa de Lançamentos; o aviso do banco abre
    aqui). O que os bancos mandaram **no mês**, ao lado do que está no Capital. Abre no mês atual
    e aceita só o anterior (o que acontece no dia 31 só chega no dia 1º). Entram o dinheiro que
    sai e entra nas contas, as compras à vista no cartão com data no mês e **a parcela do mês** de
    cada compra parcelada; Pix e compras à vista de outros meses não. Os **gastos** (dinheiro
    saindo e compras no cartão) ficam separados dos **recebimentos** (dinheiro entrando nas
    contas), em duas abas (`?tipo=gastos|recebimentos`), cada uma com quantos faltam; a tela dos
    bancos mostra a conta nos botões "Conferir gastos" e "Conferir recebimentos", que abrem cada
    aba, e a Início, "N para conferir em outubro". O mês fica no topo, com ‹ › e deslizar
    (`MonthSwipe` com `min`/`max`: além do mês anterior ou do atual, volta sozinho; `?mes=`).
    No topo de cada aba, um resumo só com contagens e uma barra ("3 faltam no Capital · 12 de 15
    conferem"), ou "Outubro confere ✓". As linhas vêm em **blocos por origem**, cada um com ícone
    e um selo ("2 faltam" / "✓ confere"): nos gastos, os cartões e, por banco, a conta (Pix e
    débito); nos recebimentos, **um bloco por banco**. Cada linha cai em uma lista:
    - **Falta no Capital**: o que pede um toque;
    - **✓ Confere** (fechada): já está no Capital. É o que foi lançado, ligado, recebido ou a
      fatura marcada por aqui; a compra parcelada que bate com uma compra do Capital; e o **par
      forte**: um lançamento feito à mão com o mesmo valor ao centavo, até 1 dia de diferença, no
      mesmo cartão quando os dois dizem, e só um candidato de cada lado ("✓ Confere com 'Mercado'
      de 12/10"). O par e o plano são calculados a cada leitura, nunca gravados: "Não é este" volta
      a linha para "Falta no Capital" sem apagar nada;
    - **Deixados de fora** (fechada): o que o app deixa de fora sozinho, sem pedir nada (as
      listas fechadas são botões com a contagem, "✓ Confere 14", e abrem uma de cada vez);
    - **Ignorados** (fechada): o que a pessoa ignorou, com o motivo quando o app tinha um, e
      **"Voltar para conferir"** (a ação `restore`, que só aceita o que está ignorado e volta a
      transação para ninguém ter decidido). O que foi tirado dos Deixados de fora antes desta
      mudança também está aqui, sem migração.
    - em "Falta no Capital", cada linha tem descrição, valor, data, banco e a categoria
      sugerida, com **"Lançar"** (um toque), o lápis (o formulário de gasto, de compra parcelada
      ou de renda, já preenchido) e, embaixo, "Procurar nos gastos" e "Ignorar". Débito sugere
      gasto, crédito sugere renda;
    - **"Procurar nos gastos"** (nos recebimentos, "Procurar nas rendas"): lista o que a pessoa
      lançou no mês (nos recebimentos, as rendas do mês e os "A receber", em aberto ou já
      recebidos), com busca pela descrição ou pelo valor e o selo "mesmo valor". O que já está
      ligado a outra linha do banco aparece apagado, sem toque ("ligado ao BTG Pactual de
      12/10"). A pessoa **marca um ou mais** e toca em "Ligar": uma compra de R$ 200 no cartão
      pode ser dois "A receber" de R$ 100, e pode ser só uma parte. Ligar não muda nada nos
      lançamentos (um "A receber" continua em aberto ou recebido como estava). As parcelas de
      compras parceladas não entram (são da compra parcelada);
    - **ligado em parte**: quando o que foi ligado soma menos que a linha, ela continua em
      "Falta no Capital" com "Ligado a 'Jogo — João' (R$ 100). Faltam R$ 100", e "Lançar o
      resto" (o formulário já com o que falta), "Está certo assim" e "Desfazer". Quando soma o
      valor da linha (ou mais), vai para "✓ Confere", com "Desfazer";
    - **vários lançamentos que somam a linha**: dois a quatro lançamentos feitos à mão que somam o
      valor ao centavo, até 1 dia de diferença, no mesmo cartão quando os dois dizem, e só essa
      combinação: "Parecem ser estes 2 lançamentos: 'Jogo — João' e 'Jogo — Pedro'", com "São
      estes" e "Não são";
    - **"A receber" já marcado como recebido**: muitas vezes a pessoa marca "Já me pagou" quando
      o amigo paga, antes de o banco contar. Um Pix recebido perto do valor de um "A receber"
      marcado como recebido até 7 dias antes ou depois pergunta "É a devolução de 'Jogo — João',
      que você já marcou como recebido?" ("É sim" liga os dois). Com o mesmo valor ao centavo,
      marcado até 1 dia do Pix e só um candidato, confere sozinho, como o par forte;
    - **categoria sugerida**, nesta ordem: o que a pessoa escolheu antes para a mesma descrição;
      uma categoria dita na descrição (as regras de `lib/categoryText`, sem IA); a categoria da Pluggy
      traduzida para os nomes das categorias da pessoa; e o que as categorias padrão significam
      (Prazeres e Confortos = comer fora, compras, lazer; Conhecimentos = cursos e livros; Metas = viagem;
      Custos Fixos = assinaturas, contas, aluguel). Sem palpite, o botão vira "Escolher
      categoria" e abre o formulário: nada é chutado;
    - **cartões** (o que importa é qual compra ficou de fora, nunca quanto se deve): a aba Gastos
      tem **um bloco por origem**, cada cartão do Capital ligado a cartões do banco ("Nubank"),
      depois os cartões do banco sem ligação e, por fim, "Conta (Pix e débito)". Cada bloco tem
      as mesmas listas, com a contagem no título ("2 faltam · 14 conferem") e nenhum total em
      reais. Cada cartão do banco é ligado uma vez a um cartão do Capital (ou "Não informar"); a
      pergunta fica no topo do bloco dele e aparece **mesmo sem compra a lançar**, porque sem ela
      o Capital não sabe em que cartão conferir. Com "Não informar", as compras conferem com
      qualquer gasto de cartão. Para cada compra do cartão:
      - **✓ Confere** quando está no Capital nesse cartão (par forte ou "É o mesmo") ou bate com
        uma compra parcelada desse cartão;
      - **Lançado fora do cartão** quando o par existe, mas no Capital está como Pix/débito, como
        cartão não informado ou em outro cartão. A linha diz onde ("está no Amazon") e oferece
        **"Pôr no Nubank"**, que salva pela mesma função do formulário (um mês fechado recusa) e
        liga a transação ao gasto;
      - **Lançado à vista, no banco é parcelado**: um gasto com o valor total, comprado até 3
        dias antes ou depois. A linha avisa ("No Capital está à vista… No banco são 10× de R$
        87,23"), com "Trocar por parcelado" (o formulário de compra parcelada já preenchido; ao
        salvar, a compra parcelada entra no lugar do gasto à vista, numa gravação só), "Deixar à
        vista" (liga os dois) e "É outra compra". Nada é trocado sozinho;
      - **Falta no Capital** quando não há nada parecido; "Lançar" já vem com o cartão ligado.
    - **compra parcelada**: as parcelas da mesma compra viram uma linha só, a **parcela do mês**
      ("Parcela 5 de 10 · total R$ 872,30 · comprada em 12/06"). Há bancos que mandam uma parcela
      por mês, com a data da fatura, e bancos que mandam todas de uma vez, com a data do dia
      seguinte à compra; por isso a parcela do mês é **o mês da compra + (n − 1)**, venha como
      vier. Quando a compra já está no Capital, vale a conta do próprio Capital (a parcela cuja
      cobrança cai no mês, pelo fechamento do cartão). "Conferir parcelado" abre o formulário de
      compra parcelada, que já sabe quantas parcelas caíram ("Começar a contar de agora");
    - **duplicados fracos**: um gasto (ou renda) lançado à mão com o mesmo valor, até 2 dias de
      diferença e no mesmo cartão, que não é par forte (2 dias, ou mais de um candidato), vira
      "Parece que você já lançou isso", com "É o mesmo" (só liga os dois) ou "É outro";
    - **deixados de fora, com o motivo à vista**: pagamento de fatura, dinheiro entre contas da
      pessoa, aplicação/resgate/rendimento e estorno. Não pedem nada; cada um tem só "Lançar
      mesmo assim" (e, na fatura, "Marcar a fatura como paga?");
    - **fatura**: um pagamento de fatura que bate com uma fatura em aberto **do Capital** sugere
      "Marcar a fatura de out (Nubank) como paga?", sempre com um toque. Nenhuma fatura sai sozinha
      e a fatura do banco nunca aparece;
    - **no módulo Cartão** (com Open Finance ligado): na aba Fatura do mês atual e do
      anterior, uma linha por cartão ligado, "2 compras do banco não estão aqui · Conferir" (abre
      a aba Gastos nesse mês, já no bloco do cartão) ou "✓ Confere com o banco". Só contagens:
      nenhum valor do banco;
    - **quem mandou ou recebeu o Pix**: a linha diz "Pix de Daniel Ferrari" ou "Pix para Ana
      Souza" (primeiro e último nome; empresa com o nome inteiro), e o lançamento já vem com esse
      nome. O nome vem do banco ou, quando um banco só manda o CPF (o BTG), do que outro banco
      disse para o mesmo CPF (o Nubank põe o nome depois de "|"). Um CPF nunca aparece;
    - **dinheiro entre contas suas**: além da categoria da Pluggy, quem pagou e quem recebeu com
      o **mesmo CPF** fica em Deixados de fora, sem perguntar nada;
    - **A receber** (com o módulo ligado): um Pix recebido perto do valor de um "A receber" em
      aberto, lançado no dia do Pix ou antes, pergunta "É a devolução de 'Jantar — João' (R$
      35,67)?". Perto é até 10% dele, ou R$ 5 quando isso for mais, para cima ou para baixo
      (quem devolve arredonda):
      - ao confirmar, a **sobra** (Pix de R$ 36: R$ 0,33) entra como renda ("Devolução a mais:
        Jantar — João") e a **falta** (Pix de R$ 35: R$ 0,67) entra como gasto em Imprevistos
        ("Faltou na devolução: …"), no dia do Pix. A caixa avisa disso antes do toque;
      - **de quem é**: primeiro o que fala de quem pagou, pelo nome que o banco mandou ou pelo que
        o app aprendeu, como nas categorias dos gastos. Cada "Marcar como recebido" ensina: o
        próximo Pix do mesmo CPF prefere o A receber com as palavras que ele já pagou ("João").
        Depois, o valor mais perto; depois, o mais recente;
      - "É outro A receber" mostra os outros em aberto perto do valor, cada um com "É este";
      - "Marcar como recebido" usa o mesmo "Já me pagou" da tela do A receber; "É outra coisa"
        volta a oferecer a renda. Nunca automático.
  - **Reserva pelos bancos** (na engrenagem da Reserva, com Open Finance ligado):
    - "Atualizar pelos bancos conectados" lista as contas e os investimentos de cada banco. Nada
      vem marcado: o app não supõe qual banco é a reserva de cada um;
    - investimentos de renda fixa aparecem de cara; ações e fundos ficam atrás de "Mostrar ações
      e fundos", e o que tem saldo zero não aparece;
    - a "Reserva em conta" passa a ser a soma do que foi marcado, reescrita a cada leitura, e o
      campo fica só leitura com "BTG Pactual · atualizado há 5 h". Se um banco parou, avisa que o
      valor é o último que chegou;
    - "Mudar as contas da reserva" e "Voltar a digitar à mão" (o último valor fica para editar).
  - **Quantidades no Diagrama** (aba "Ativos e notas", com Open Finance ligado): a
    corretora diz quantas ações e cotas a pessoa tem, e o Diagrama confere ativo por ativo:
    - com o Diagrama ligado, a tela dos bancos tem **"Conferir investimentos"**: abre o Diagrama
      (`/diagrama?aba=ativos&conferir=1`) já na conferência, só com o que difere, ou com "Tudo
      confere com BTG Pactual". Se as quantidades ainda não chegaram, diz que vêm na próxima
      leitura;
    - cada ativo com código da B3 ganha "✓ Confere com BTG Pactual" ou "BTG Pactual: 120 · aqui:
      100" com **"Usar 120"**, que salva pela mesma função da ficha do ativo. Nada é trocado
      sozinho: uma compra leva uns 2 dias úteis para aparecer (liquidação na B3), e a linha de
      ajuda diz isso junto com "atualizado há 5 h" (ou que um banco parou);
    - um ativo que nenhum banco mandou aparece como "BTG Pactual: 0 · aqui: 50", com "Usar 0";
      se o banco tem outra classe da mesma empresa que o Diagrama não tem, a linha avisa ("No
      banco tem KLBN4: 157."), porque pode ser só o código trocado;
    - "Ver só os ativos diferentes do banco" esconde os que conferem;
    - **"No banco, mas não no Diagrama"**, com "Adicionar": o formulário de ativo já vem com o
      código, a quantidade e o tipo (ação → Ações nacionais, FII → Fundos imobiliários, BDR → Ações
      internacionais). Num ETF, ou num código terminado em 11 que o banco chama de ação (o BTG põe
      ali ETFs e FIIs, como AUVP11 e PMLL11), a pessoa escolhe o tipo e a busca traz o nome e se é
      ETF. Começa recolhido quando passa de 3 itens. Não são oferecidos o que a pessoa marcou como
      Reserva na lista dos bancos nem direitos de subscrição e recibos (finais 1, 2, 9, 10, 12–15,
      como HGRU12);
    - ficam de fora a renda fixa, os fundos sem código da B3, as opções e o que o Open Finance não
      traz (ativos no exterior, cripto): VOO ou BTC nunca aparecem como "faltando no banco";
    - **Reserva investida:** com o módulo Reserva ligado, as cotas dela contam junto com as do
      Diagrama no ticker dela (AUPO11…), porque costumam estar na mesma corretora. "Aqui" vira
      Diagrama + Reserva, e a correção só mexe no Diagrama ("Deixar 30 aqui" = banco − Reserva). Se
      a Reserva sozinha tem mais do que o banco, a linha leva a "Ver a Reserva".

### Navegação: a Início como a tela de um celular

Não há rodapé: a **Início** (`/mes/[mês]`) faz o papel da tela inicial de um celular (HyperOS), e
`/` sempre abre a Início do último mês visto.

- **Áreas de trabalho** (`resolveHomePages` em `lib/modules/home.ts`): a Início tem até **5 áreas**
  lado a lado, cada uma com os seus widgets, salvas por conta em `budget_settings.home_pages`
  (vale em todos os aparelhos; conta nova começa com a Início da conta modelo). Deslizar para o
  lado troca de área com a física de antes (a tela acompanha o dedo, cede na primeira e na última,
  troca com 30% da largura ou um peteleco, `components/layout/swipePhysics.ts`); funciona com mouse
  e com as setas, e os quadradinhos logo acima de "Apps" (sempre, mesmo com uma área só) dizem
  quantas áreas há e em qual você está. Cada área rola sozinha e guarda a
  própria posição; a área aberta fica guardada na sessão. Um módulo novo no catálogo traz o widget
  dele para o fim da última área; um widget extra (o Calendário dos Lembretes) entra logo depois do card do
  seu módulo, e Missões entra no topo da primeira área. Um Início salvo antes das áreas
  (`home_order`) vira a área 1.
- **Bandeja de apps** (`components/layout/AppDrawer.tsx`): a setinha embaixo da Início (toque, Enter
  ou arrastar para cima) abre o que era o Mais: a conta, **todo** módulo com tela, agrupado
  (com o selo de lembretes não lidos no ícone), Privacidade, Configurações e, para o dono,
  Administração. Em grade ou lista. Fecha com o botão voltar do celular, Esc, o "⌄" ou arrastando
  para baixo. Links antigos para `/mais` abrem a Início com ela aberta; `/rodape` leva à Início.
- **Gestos que se mostram** (dicas de uma vez só, nunca um tour): a setinha tem o rótulo "Apps" e,
  até a bandeja ser aberta uma vez, dá uns pulinhos discretos quando a Início aparece
  (`hint:apps`). Com mais de uma área, a primeira vez mostra "Deslize para o lado para ver a outra
  tela" (`hint:swipe-areas`); nas telas com mês (Lançamentos, Categorias e a fatura do Cartão),
  "Deslize para trocar o mês" aparece embaixo do mês (`hint:swipe-month`, uma vez para todas). Cada
  dica (`useOneTimeHint`) fica salva nos avisos vistos assim que aparece, some sozinha em 6 segundos
  ou quando a pessoa faz o gesto, e as setas ‹ › continuam. Os avisos vistos só crescem: o
  `SettingsProvider` junta os de saves feitos ao mesmo tempo e salva um de cada vez, para nenhum se
  perder.
- **Telas de módulo**: toda tela tem a seta de voltar para a Início (como fechar um app), e a de uma
  categoria volta para Categorias.
- **Modo de edição** (o lápis, ou segurar num espaço vazio): as áreas encolhem e mostram a borda das
  vizinhas. Segure um widget (240 ms) e arraste para mudar de lugar, até a borda (600 ms) para levar
  à área do lado, ou, na última, criar uma área nova; "Mover" faz o mesmo sem arrastar. **Só o "−"
  vermelho tira um widget da Início**: soltar um widget, em qualquer lugar, nunca tira. A **bandeja
  de widgets** embaixo traz de volta os tirados, com um toque ou arrastando até o lugar. Excluir uma área leva os widgets dela para a área do
  lado; áreas vazias somem ao sair. "Voltar ao padrão" põe a Início da conta modelo
  (`GET /api/v1/settings/home`). Tudo salva na hora; o botão voltar do celular fecha a bandeja e depois
  sai do modo de edição. O seletor de mês fica no topo de todas as áreas.
- **Widgets** (`components/modules/home`): tocar num widget abre a tela do módulo. Cada um carrega
  os próprios dados, mostra esqueleto enquanto carrega e, se falhar, não derruba os outros; a
  carteira e os lembretes são lidos uma vez para todas as áreas.
- **Endereço de módulo restrito** (`ModuleGate`): para quem não tem acesso, só "Página não
  encontrada".
- **Avisos já vistos**: `budget_settings.dismissed_notices` guarda, por conta, as chaves dos avisos
  de uma vez só: as perguntas da primeira visita de um módulo (`intro:<módulo>`), as dicas de
  gesto e futuros cards de novidade.

### Ajuda, configurações e primeira visita de cada módulo

- **Ajuda ("?")**: todo módulo tem um botão que roda o tour só dele, o spotlight do driver.js que
  escurece a tela, destaca uma parte por vez e explica para que serve. Fica no topo da tela do
  módulo; nos módulos sem tela, no card do Cartão no Início e na aba A receber de Lançamentos. Os passos ficam em `lib/modules/tours.ts` (um `Record` por módulo, então módulo sem
  tour não compila), **no máximo 4 por módulo, cada um com uma linha** (um teste confere) e apontam só para a tela do módulo (ou para o widget dele, e a Início troca
  para a área em que ele está), nunca para a setinha ou as bandejas. Todo tour termina no
  próprio botão de ajuda. O motor (`components/modules/tour/TourProvider.tsx`) navega entre as
  telas, espera cada elemento aparecer, abre e fecha o formulário de gasto quando
  o passo pede e volta para onde começou. Um teste confere que toda âncora de tour existe nas telas e
  que todo módulo tem o botão de ajuda.
- **Configurações do módulo (engrenagem)**: ficam na tela do próprio módulo. Categorias: nome,
  descrição, cor, ordem e metas (com a regra dos 100%), e "Restaurar categorias padrão".
  Lançamentos: nome, descrição e cor das categorias, sem metas. Lembretes: notificações deste
  aparelho e horários para lembrar de novo. Cartões: horário do aviso, insistir
  até a fatura ser paga e notificações deste aparelho. Contas do mês: aviso no dia do vencimento,
  horário, lembrar de novo até lançar e notificações deste aparelho. Reserva: reserva em conta,
  custos de emergência e o ativo das cotas. **Configurações** fica só com o que é
  geral: conta, tema, backup, dados locais e apagar tudo (Privacidade fica na bandeja de apps).
- **Primeira visita** (`useModuleIntro`): o tour nunca começa sozinho, só pelo "?". O único módulo
  que pergunta algo sozinho na primeira visita é Categorias, com a configuração das categorias
  (veja abaixo). Fica guardado por conta,
  então acontece uma vez só, no aparelho que chegar primeiro. Não existe
  mais um tour geral do app nem uma "Ajuda" geral: a ajuda de cada coisa fica na tela dela.

- **Confirmações** (`useConfirm`): título e uma frase só, com o que importa para decidir ("As compras
  de Nubank passam para a fatura Não informado.").

### Categorias

- **Sempre as mesmas 4** (`DEFAULT_TOPICS` em `lib/budget/topics.ts`): uma pessoa tem 4 metas para
  os gastos da vida, então toda conta tem exatamente estas, nesta ordem: **Prazeres e Confortos**
  (passeios, presentes, restaurantes e o que poderia esperar, mas você quer agora; antes se chamava
  "Diversos", e o `preset` continua `diversos`), **Investimentos** (qualquer investimento que faça o
  dinheiro render), **Metas** (casa, carro, casamento, aniversário, viagem) e **Conhecimentos**
  (cursos, livros, eventos). Nome, descrição e ordem são fixos: não se cria, não se arquiva e não se
  renomeia categoria. A pessoa só muda a **%** e a **cor**. Para acompanhar algo à parte (o
  mercado, uma viagem), existem as **tags** (abaixo).
- **O servidor garante** (`enforceFixedTopics`): um salvamento de configurações só aproveita a % e a
  cor de cada uma das quatro; uma categoria a mais, outro nome, outra descrição, outra ordem ou
  `archived` são ignorados. Importar um backup antigo passa por `consolidateBudgetData`.
- **Contas de antes** (`lib/server/fixedTopicsMigration.ts`, uma vez, marcada em `job_runs`):
  "Diversos" virou "Prazeres e Confortos" também nos meses passados; uma das quatro que estava
  arquivada voltou com 0%; e uma categoria criada pela pessoa foi juntada a Prazeres e Confortos —
  a % dela, a sobra, os gastos, as rendas direcionadas, os modelos de Contas do mês, os
  parcelamentos, as categorias da reserva investida e a memória de categoria dos Bancos —, para os
  meses somarem o mesmo que antes.
- **Custos Fixos**: um gasto de todo mês que é maior do que o limite médio mensal da categoria vai
  para custos fixos, e não para a categoria (sem exemplo de valor: depende de quanto cada categoria
  recebe). A tela Categorias explica renda, custos fixos, imprevistos e cada categoria. O nome
  padrão está no plural — é uma categoria que
  guarda vários custos, e no singular parecia uma conta só; quem já tinha a conta criada foi
  renomeado uma vez só (`lib/server/fixedCostLabelMigration.ts`), e só quem ainda estava no nome
  padrão: um nome escolhido pela pessoa nunca é tocado.
- **Voltar às % padrão** (na engrenagem da tela Categorias): as quatro voltam às % e cores de
  quando a conta começou, com "Desfazer".
- **Configuração das categorias** (`OnboardingWizard`: no primeiro acesso, na primeira visita a
  Categorias e no botão "Me ajude com as %"), em 3 passos, sempre com "Pular" (o da primeira visita
  leva para a Início; o de "Me ajude com as %" fica em Categorias): a renda; os custos
  fixos e os imprevistos na mesma tela (só para a prévia, nada é lançado; a regra do custo fixo fica
  no ⓘ); e as porcentagens, cada categoria com a descrição dela embaixo do nome e a prévia de quanto
  a % deixa para gastar.
- **"Fora do orçamento"** (`categoryKind: 'uncounted'`): ao lado das categorias, no formulário de
  gasto, fica a saída de emergência — marcada **"Não recomendado"** ali mesmo, e explicada em duas
  linhas sempre que é escolhida. O gasto fica registrado e, se foi no cartão, entra na fatura, mas
  **não consome nenhuma categoria** e fica fora do total gasto do mês e do rateio dos custos fixos
  (é o mesmo mecanismo do "A receber", mas sem ninguém para devolver o dinheiro — por isso o
  aviso). Não é um módulo: está sempre ali, como Custos Fixos e Imprevistos, que continuam como
  sempre foram, e o nome e a cor dela podem ser mudados na engrenagem, junto com as outras. Em Lançamentos ela só ganha uma aba
  **depois** que o mês tem algum gasto assim, para não ficar convidando.

- **Renda para uma categoria só** (`Income.topicId`): no formulário de renda (com o orçamento
  ligado), "Para quais categorias" oferece **"Todas, pelas %"** — marcada **"Recomendado"** e o
  padrão — e **"Uma categoria só"**, marcada **"Não recomendado"** e explicada sempre que é
  escolhida. A renda direcionada entra no total de renda do mês, mas não passa pelas %: vai
  inteira para o "posso gastar" da categoria escolhida ("+ Renda só desta categoria" no detalhe
  dela). Se a categoria não estiver mais no mês, a renda volta a ser dividida pelas %, para
  nenhum dinheiro sumir do orçamento.

### Tags

**Categoria** é uma das 4 metas e decide de onde sai o dinheiro. **Tag** é só um rótulo para achar
depois: não muda nenhum número — nem limite, nem sobra, nem fatura, nem histórico. Nenhum arquivo de
cálculo de `lib/budget` lê tag (há um teste que compara o mesmo mês com e sem tags). As regras ficam
em `lib/budget/tags.ts`.

- **Duas listas**: tags de gasto ("Mercado", "Restaurante", "Viagem") e tags de renda ("Trabalho",
  "Bico"); uma não aparece na outra. Até 10 tags por lançamento, 100 por lista, nome de 1 a 30
  letras, sem repetir na mesma lista (maiúsculas e acentos não contam) e nunca com o nome de uma
  das 4 categorias. Conta nova começa sem tags; o campo sugere as de cima com um toque.
- **Marcar**: o campo **Tags** (opcional) fica no fim dos formulários de gasto, renda, conta do
  mês e parcelamento, com "+ Nova tag" ali mesmo. A primeira vez, uma linha explica a diferença
  para categoria (aviso de uma vez, `tags-vs-categories` em `dismissed_notices`).
- **Filtrar** em Lançamentos: o "Filtrar" das duas abas tem as tags do tipo delas (em Gastos,
  junto das categorias). Dentro das tags é "ou", dentro das categorias também, e entre as duas é
  "e" ("Prazeres e Confortos" + "Restaurante"). A linha "N gastos · R$ X" responde "quanto foi no
  mercado este mês"; a busca também acha pelo nome da tag; e o filtro de tag vai junto ao trocar
  de mês (`?tags=`). Cada linha mostra as tags em pílulas `#Mercado` (duas e "+N").
- **Editar**: na engrenagem de Lançamentos (seção Tags) e em "Editar tags" no formulário. Criar,
  renomear e trocar a cor salvam na hora (o lançamento guarda o id, então o nome novo vale em
  todo lugar). **Apagar** diz de quantos lançamentos ela sai e a tira de todos, das contas do mês
  e dos parcelamentos na mesma transação, com "Desfazer" (`deleteTag` devolve onde ela estava e
  `restoreTag` a põe de volta).
- **Mês fechado**: pôr ou tirar tag é permitido, como o "Já me pagou" (`setEntryTags`); o
  formulário de um mês fechado só deixa mudar as tags.
- **Contas do mês e parcelamentos herdam**: o gasto lançado de um modelo, cada parcela e o gasto
  "à vista" de um parcelamento nascem com as tags dele. Mudar a tag do modelo não reescreve o que
  já foi lançado; editar o parcelamento refaz as parcelas com as tags dele.
- **Servidor**: as tags vivem em `budget_settings.tags` e mudam só pelas rotas `/api/v1/tags`
  (um salvamento comum das configurações nunca as toca). Cada lançamento, modelo e parcelamento
  guarda `tag_ids`, só com ids que existem e do tipo certo; um cliente antigo que não manda
  `tagIds` mantém as que estavam. Backup versão 4; os de antes entram sem tags.
- Fora do escopo: meta ou limite por tag, gráfico por tag e tag sugerida na revisão de Bancos (o
  que é confirmado direto de lá nasce sem tag; aberto no formulário, dá para pôr).

## Como rodar (desenvolvimento)

Requer Node.js 22+ e acesso a um Postgres: o de desenvolvimento no Orange Pi, pela Tailscale
(veja [deploy/postgres/README.md](deploy/postgres/README.md)).

```bash
npm install

cp .env.example .env.local   # DATABASE_URL (banco capital_dev), BETTER_AUTH_SECRET e BETTER_AUTH_URL

npm run dev      # servidor de desenvolvimento em http://localhost:3000 (aplica as migrações ao subir)
npm run build    # build de produção
npm start        # serve o build de produção

npm test         # testes (Vitest); o repositório roda contra um Postgres em memória (PGlite)
npm run lint     # ESLint
npm run format   # Prettier

npm run db:generate   # gera uma migração SQL em /drizzle a partir de lib/server/db/schema.ts
npm run db:migrate    # aplica as migrações pendentes na DATABASE_URL (o servidor já faz isso ao subir)
```

Sem `SMTP_HOST` no `.env.local`, os e-mails de confirmação de conta e de redefinição de senha não
são enviados: o conteúdo, com o link, aparece no terminal do `npm run dev`.

**Conta de teste do primeiro acesso.** Com `TEST_ACCOUNT_EMAIL` (terminado em `.test`) e
`TEST_ACCOUNT_PASSWORD` no `.env.local`, entrar com esse e-mail e essa senha cria a conta (já
confirmada) e apaga todos os dados dela **a cada login** (`lib/server/testAccount.ts`): ela sempre
abre como uma conta nova, para testar o que aparece primeiro. Um e-mail que não termine em `.test`,
ou o `OWNER_EMAIL`, é ignorado, então nenhuma conta de verdade é apagada por engano.

**Conta modelo da Início.** Com `HOME_TEMPLATE_EMAIL` e `HOME_TEMPLATE_PASSWORD`, entrar com esse
e-mail e essa senha cria a conta modelo (já confirmada, nunca apagada): a Início que você arrumar
nela é a de toda conta nova (veja "Módulos", no começo).

Ao entrar pela primeira vez, uma conta nova recebe as 4 categorias padrão e as categorias
especiais, sem mês de exemplo. Se o dispositivo tiver dados da versão local anterior, o app
oferece importá-los para a conta.

## Publicar no Orange Pi

No Pi, tudo do Capital fica em `~/capitalapp`:

```text
~/capitalapp/
├── Capital/   este repositório; o app roda em Docker a partir daqui (./update.sh)
├── db/        o banco: cópia de deploy/postgres (docker-compose.yml, .env com as senhas, scripts)
└── data/      arquivos do Postgres e backups
```

1. **Banco** (uma vez): siga [deploy/postgres/README.md](deploy/postgres/README.md). Ele sobe o
   Postgres 17 e o backup diário, e cria a rede Docker `capital-db`.
2. **App:**

   ```bash
   cd ~/capitalapp/Capital
   cp .env.example .env.local
   # DATABASE_URL=postgres://capital:<CAPITAL_DB_PASSWORD de ~/capitalapp/db/.env>@capital-postgres:5432/capital
   # BETTER_AUTH_SECRET=<openssl rand -base64 32>
   # BETTER_AUTH_URL=https://capital.rincon.dev.br
   # APP_ALLOWED_ORIGINS=capital.rincon.dev.br
   # SMTP_* (Gmail com senha de app)
   # VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT (notificações) e ACTION_TOKEN_SECRET
   #   — um par/segredo próprio do Pi; os comandos para gerar estão no .env.example
   # ENCRYPTION_KEY (Open Finance; o comando para gerar está no .env.example)
   docker compose --env-file .env.local up -d --build
   ```

   O container `capital` entra na rede `capital-db` e fala com o banco pelo nome
   `capital-postgres`. Ao subir, ele aplica as migrações pendentes (`instrumentation.ts`). A
   imagem é construída na arquitetura da placa (arm64). `APP_ALLOWED_ORIGINS` entra também como
   build arg: **reconstrua** (`up -d --build`) sempre que mudar.

Atualizar depois: `./update.sh` (faz `git pull` + rebuild + restart + limpa imagens órfãs; recusa
rodar se o banco não estiver no ar).

Placas com 1–2 GB de RAM: crie swap antes do primeiro build —
`sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`.

**HTTPS:** o app só funciona por HTTPS de ponta a ponta, por causa do cookie de sessão `Secure` e
da instalação do PWA. Ele é publicado em `https://capital.rincon.dev.br` por um túnel Cloudflare
(container `cloudflared` no Pi) apontando para a porta 3000; `tailscale funnel`/`serve` também
serve. Mantenha a mesma URL: trocar de domínio perde a instalação do PWA no celular.

**Porta só para o túnel:** o container publica a porta 3000 apenas em `127.0.0.1` (só o próprio
Pi), para ninguém na rede falar direto com o app, pular a Cloudflare e forjar o IP que os limites
de acesso usam (`cf-connecting-ip`). Funciona sem mudar nada quando o `cloudflared` roda com
`network_mode: host` e aponta para `http://localhost:3000`. Se ele alcança o app por outro
caminho, ponha esse endereço em `CAPITAL_BIND` no `.env.local` (ex.: `172.17.0.1`, o gateway da
rede Docker, com o túnel apontando para `http://172.17.0.1:3000`).

**Proteção contra sobrecarga:** o app conta as requisições por segundo e lê a temperatura da placa
(`lib/server/loadGuard.ts`). Um IP que exagera é bloqueado sozinho por um minuto; se o total passar
do ponto crítico, ou a placa esquentar demais, o servidor responde "volte em instantes" por um
tempo em vez de cair. O dono (`OWNER_EMAIL`) recebe um aviso no celular, e tudo aparece em
**Administração** (na bandeja de apps). Os limites ficam no `.env.local` (veja o `.env.example`).

### Instalar no Android

Abra a URL HTTPS no **Chrome do Android** → menu ⋮ → **Instalar app**. Vira um app standalone
(ícone na gaveta, tela cheia, atualiza sozinho). É o caminho recomendado para beta testers —
sem APK, sem loja.

**APK / Play Store (opcional):** com o PWA no ar, use [PWABuilder](https://www.pwabuilder.com)
ou o Bubblewrap CLI para gerar um TWA (`.apk` para sideload, `.aab` para a Play Store). Para
tirar a barra de endereço, publique `/.well-known/assetlinks.json` com o fingerprint de
assinatura que a ferramenta fornece.

Os ícones em `/public/icon-*.png` são placeholders — troque por arte real antes de publicar
na loja (`node scripts/generate-icons.mjs` regenera os placeholders a partir de um SVG).

## Arquitetura

```
/app                    Rotas (Next.js App Router) e composição de telas
  /api/v1                API do app (Route Handlers): o único caminho até o banco
  /api/auth              Endpoints do Better Auth (destino dos links dos e-mails)
/components
  /screens               Uma tela por arquivo (Início, Categorias, Lançamentos, Configurações…)
  /modules               Ícones dos módulos, o 404 dos restritos e os cards do Início
  /month                  Componentes e contexto compartilhados pelas rotas /mes/[month]/*
  /history                Gráficos (Recharts) e o indicador de aderência à meta
  /layout, /ui, /providers, /pwa
/lib
  /budget                 Regras de negócio — funções puras, sem React nem storage
  /reminders              Regras dos lembretes (vencimentos, quando notificar, textos), puras, no fuso de São Paulo
  /categoryText           Achar uma categoria num texto (a descrição de uma transação do banco), puro
  /notifications          Web Push: tipos, nome dos aparelhos e o lado do navegador (permissão, inscrição)
  /modules                A ficha de cada módulo, dependências, bandeja de apps e áreas da Início (puras)
  /storage                Contrato BudgetRepository e o repositório do navegador (HTTP)
  /server                 Só no servidor: banco (Drizzle), repositório Postgres, auth, e-mail, API
  /auth                   Server Actions de autenticação (entrar, criar conta, sair, redefinir senha)
  /hooks                  Hooks React que ligam a UI ao repositório (useMonthData, useAllMonths)
/drizzle                  Migrações SQL (geradas por `npm run db:generate`)
/deploy/postgres          Stack Docker do banco no Orange Pi (Postgres + backup)
/scripts                  Migrações manuais e a geração dos ícones do PWA
/proxy.ts                 Portão das rotas: sem cookie de sessão → /login (páginas) ou 401 (API)
/instrumentation.ts       Aplica as migrações e liga a agenda em segundo plano quando o servidor sobe
```

### Agenda em segundo plano (`lib/server/scheduler.ts`)

Roda dentro do próprio servidor do Capital, sem n8n nem container extra: a cada minuto (5 s
depois da virada) envia as notificações de lembrete que venceram, os avisos das faturas e das
Contas do mês e, no horário da B3 (dias úteis, 10:00–18:30), atualiza a cotação dos ativos que alguém
tem, a cada 30 min. De hora em hora também avisa, pelo sino, quem já tinha conta quando uma
novidade do app entrou no ar (`lib/notifications/announcements.ts`). Cada tarefa guarda
quando rodou (`job_runs`): depois de um deploy ou reinício ela recupera o que ficou para trás, e
cada envio é anotado antes (`reminder_deliveries`, chave única), então nada sai duas vezes.
`SCHEDULER=off` desliga a agenda num servidor.

Excluir uma notificação (arrastando para o lado) **não** apaga a linha quando ela tem `source_key`
— a de uma novidade, por exemplo: só marca `dismissed_at`, e a linha continua lá como lápide. Sem
isso o índice único `(user_id, source_key)` deixaria de enxergá-la e a tarefa mandaria exatamente o
mesmo aviso na hora seguinte, e na outra, e na outra. Notificação sem `source_key` (lembrete) ninguém recria, então essa é apagada de verdade.

**Limites do Google:** a permissão de ler e-mails é um escopo "restrito". Com o app "Em produção"
e sem a verificação paga do Google, até 100 pessoas conseguem conectar, e cada uma vê uma vez o aviso
"app não verificado" (Avançado → Acessar). A verificação só compensa para abrir a muito mais gente.
O servidor guarda, cifrado, o acesso de leitura ao e-mail de cada pessoa que conectar: quem
administra o servidor precisa ser de confiança para elas. Cada conta gasta poucas chamadas por
minuto, quase só espera de rede.

### Open Finance pelo Meu Pluggy (`lib/server/banks`)

Só leitura. Cada pessoa usa a própria aplicação grátis da Pluggy (o Client ID e o Secret são
dela); o servidor não tem chave da Pluggy. Como o módulo nasceu (F0–F6) está em
`docs/prompt-open-finance-pluggy.md`; a virada para "só conferir o mês" (C1–C7, 2026-10-21), em
`docs/plano-open-finance-conferencia.md`.

- `pluggy.ts` fala com `https://api.pluggy.ai` por `fetch`, sem SDK.
- `service.ts` tem os fluxos:
  - conferir e salvar a chave;
  - criar o item, esperar o link de autorização e guardar a conexão como `pending`;
  - ler os itens `pending` a cada visita à tela: os que chegaram ganham as contas, os
    investimentos (com as quantidades, para "Conferir investimentos" já funcionar) e um nome
    sugerido; os que esperam autorização 2 min depois de o link vencer são apagados aqui e na
    Pluggy;
  - tirar um banco e desconectar tudo.
- `repository.ts` guarda:
  - a chave (`bank_keys`, Secret cifrado com `secretBox`);
  - as conexões (`bank_connections`, a única lista dos itens, porque o plano grátis não lista);
  - as contas (`bank_accounts`), com saldo, data do saldo e, nos cartões, limite e vencimento.
    Só o nome e o tipo chegam ao navegador (`listConnections`); os saldos servem à Reserva
    (`reserve()`), e o limite e o vencimento não são mostrados;
  - os investimentos (`bank_investments`), lidos junto, sem impedir a leitura do resto se
    falharem, com o código (ticker), o ISIN e a quantidade que a corretora manda;
  - a marca `feeds_reserve` de contas e investimentos. `writeReserve` grava a soma do que está
    marcado em `cash_settings.reserve_account_amount` depois de cada leitura com novidade, ao
    marcar e ao salvar a configuração da Reserva (o valor digitado não vence o dos bancos);
  - as transações (`bank_transactions`), pela id da Pluggy.
- As transações:
  - ficam como a Pluggy manda, com o cartão positivo na compra;
  - `outcome`/`entry_id` dizem o que viraram no Capital (F5), e uma leitura nova nunca mexe nisso;
  - nada disso é lançamento.
- **Sincronização** (`job.ts`, uma vez por hora na agenda, com `job_runs`), para cada conta que
  pode usar o módulo (com acesso, enquanto ele for restrito), com ele ligado e a chave salva:
  - pergunta `GET /items/{id}` de cada banco;
  - **só quando `lastUpdatedAt` mudou** (o banco mandou dados), relê contas e transações: um ano
    na primeira vez, depois desde a última leitura menos 7 dias;
  - a pendente vira confirmada na mesma linha, nunca em duas;
  - um banco ou uma pessoa que falha não para os outros, e duas leituras da mesma pessoa nunca
    rodam juntas;
  - enquanto a Pluggy atualiza (`UPDATING`), o banco mantém o status que tinha;
  - um item que sumiu da Pluggy (404) vira "Trazer de novo";
  - uma leitura que volta sem contas mantém as que havia.
- "Parado" (48 h sem dados) e o aviso de autorização (15 dias antes) saem de `lib/banks/health.ts`.
- **Conferir o mês** (`review.ts`, lógica pura em `lib/banks/review.ts`, pensada para servir
  também a um "Importar extrato" OFX/CSV depois):
  - `buildReview(deps, { month })` (padrão: o mês atual em `zonedToday()`; só aceita o atual e o
    anterior, senão `MONTH_OUT_OF_RANGE`) lê as transações do mês, com 2 dias a mais de cada
    lado (para o par forte não depender do mês olhado), e todas as parcelas de compras no
    cartão, de qualquer data; separa `expenses` e `incomes`, cada um em `missing`, `matched`,
    `leftOut` e `ignored`. Carrega os lançamentos do mês e dos vizinhos e os parcelados;
  - a resposta traz também `entries` (gastos e rendas do mês e os "A receber", com `tied`: o
    banco e o dia da linha a que cada um já está ligado), para "Procurar nos gastos";
  - os vínculos feitos à mão ficam em `bank_links` (migração `0032`: transação × lançamento,
    vários por linha); a ação `link` confere que a linha está sem decisão e que o lançamento não
    está ligado a outra linha (`ENTRY_TAKEN`), e `unlink` desfaz. Se a linha confere é calculado
    a cada leitura (`coverage`); `findSplit` acha a combinação que soma a linha e
    `receivedCandidates`/`isStrongReceived`, o "A receber" já recebido
    (`receivedReimbursables`). Um Pix ligado a um "A receber" também ensina quem pagou
    (`paybackHistory`);
  - `bankInstallmentIn` (mês da compra + n − 1), `planChargeIn` (a cobrança do plano no mês) e
    `strongPairs` (um candidato de cada lado) são puros;
  - `GET /api/v1/banks/review?month=` e `GET /api/v1/banks/review/counts?month=` (as contagens,
    também por cartão do Capital, pelo mesmo `buildReview`);
  - cartões: `onExpectedCard`/`entryWhere` dizem se o gasto está no cartão que o banco diz
    (`CardExpectation`: o cartão ligado, qualquer cartão com "Não informar", ou "unknown" sem
    ligação ou sem o módulo Cartão). O par forte procura primeiro no mesmo cartão e, num cartão
    ligado, depois em qualquer outro; o par que não está no cartão vira `misplaced`, e a ação
    `card` ("Pôr no…") salva por `saveExpense`/`saveInstallment`. `findUpfront` acha a compra
    lançada à vista, e a ação `plan` com `replaces` troca o gasto pela compra parcelada numa
    gravação só (`replaceExpenseWithInstallment`). Nenhuma resposta leva saldo, fatura ou limite
    do banco (há teste para isso);
  - `applyReviewAction` lança com as **mesmas funções dos formulários** (`saveExpense`,
    `saveInstallment`, `saveIncome`), com `source: 'import'`;
  - antes de lançar, as transações são "reservadas" (`outcome = 'launching'`): um segundo toque
    ou outro aparelho recebe "Isso já foi conferido" em vez de um segundo lançamento, e uma falha
    (mês fechado, por exemplo) devolve a transação à lista;
  - `outcome` e `entry_id`/`entry_month` dizem o que cada transação virou;
    `bank_category_memory` guarda a categoria escolhida por descrição;
  - o vínculo de cartão fica em `bank_accounts.capital_card_id`/`card_linked`;
  - **A receber** (`reimbursementCandidates`, `paybackTolerance`): o servidor confere a distância
    de novo ao marcar (longe demais responde `TOO_FAR`), lança a sobra (`saveIncome`) ou a falta
    (`saveExpense` em `unforeseen`) antes do "Já me pagou", e o que o app aprendeu de quem pagou
    sai das próprias transações já conferidas (`outcome = 'reimbursed'` + a descrição do A
    receber, por `payerKey`: o CPF/CNPJ, ou o nome), sem tabela à parte.
- **Avisos** (`alerts.ts`, lógica pura em `lib/banks/alerts.ts`):
  - o job e "Buscar novidades" passam por `syncAndNotify`;
  - `arrivalAlerts` monta o `buildReview` do mês atual e do anterior e conta, por banco, as
    linhas de "Falta no Capital" com alguma transação nova desta leitura (`reviewAlertBody`,
    `reviewAlertUrl`); sem Lançamentos ligado, não há o que conferir;
  - `sourceKey` evita repetir: o aviso por lote, o banco parado pela data do último dado e a
    autorização pela data de vencimento;
  - `PushMessage.silent`: o `public/sw.js` passa `silent` ao `showNotification` e não usa
    `renotify` quando é silencioso. Um service worker antigo ignora o campo (toca);
  - as escolhas ficam em `bank_settings.alerts` (`alertSettingsOf` converte o que estava salvo).
- **Quantidades** (`GET /api/v1/banks/holdings`, lógica pura em `lib/banks/holdings.ts`): a rota
  devolve os investimentos com o banco de cada um e, com o módulo Reserva ligado, o ticker e as
  cotas da Reserva investida. A comparação roda na tela (`checkHoldings`), de novo a cada mudança
  do Diagrama, sem perguntar aos bancos:
  - entram ações, FIIs, ETFs e BDRs (`EQUITY`/`ETF`, subtipos `STOCK`, `REAL_ESTATE_FUND`, `ETF`,
    `BDR`) cujo código vira um ticker da B3 (maiúsculas, sem `.SA`, sem o `F` do fracionário);
  - soma por ticker entre bancos e linhas; uma linha sem quantidade tira o ticker da conta;
  - resultado por ativo: confere, diferente, só no Capital (com quantidade acima de 0) e, à
    parte, só no banco. Tolerância de 0,0001 cota;
  - a correção é sempre um toque da pessoa, por `updateAsset`, e nunca toca a Reserva investida;
  - a migração `0030` recua 1 s o `synced_update_at` de cada banco já lido: a próxima
    sincronização da hora relê tudo uma vez (como se o banco tivesse mandado dados) e as
    quantidades chegam sem esperar o banco. Até lá, a tela não mostra conferência nenhuma.
- O `apiKey` (2 h) fica só em memória, por pessoa.
- Toda rota confere o "Restrito" (`access.ts`) e tem limite de tentativas.
- A Pluggy devolve a pessoa para `<BETTER_AUTH_URL>/bancos`, ou para `PLUGGY_REDIRECT_URI`, que
  precisa ser https (no desenvolvimento, o endereço publicado; depois, volte à aba do localhost).
- "Apagar todos os dados" leva o Open Finance junto e tira os itens da Pluggy.
- A chave e as conexões ficam fora do backup: sem a chave, não há o que restaurar.

**Como a pessoa conecta:** os bancos se conectam **uma vez** em meu.pluggy.ai (a autorização é no
app do banco). O dashboard.pluggy.ai só cria a chave: uma aplicação com o conector MeuPluggy
ativo. O aviso de "teste de 15 dias" não vale para uso pessoal. No Capital, cada banco é **uma
autorização** no meu.pluggy.ai, sem passar de novo pelo banco. São até 5 conexões, do mesmo
titular, e os dados chegam uma vez por dia.

**O que a F0 conferiu na API (2026-10-20, com BTG, Nubank e um cartão Amazon Mastercard; a Caixa
não conectou nem no próprio Meu Pluggy):**

- **A conexão se cria sem widget.** `POST /items` com `connectorId: 200`, `parameters: {}`,
  `oauthRedirectUri` (HTTPS, nunca localhost) e `clientUserId`. Em menos de 1 s, o item fica
  `WAITING_USER_INPUT` e o endereço de autorização chega em `parameter.data` (`type: "oauth"`).
  **Esse endereço vale 4 minutos**: crie o item só quando a pessoa tocar e mande-a direto para lá.
  A pessoa escolhe **um banco** em meu.pluggy.ai e volta pelo `oauthRedirectUri`, com
  `?itemId=…` acrescentado. Em ~1,5 min o item fica `UPDATED`/`SUCCESS`. Às vezes a primeira
  leitura falha do lado da Pluggy (`OUTDATED`, `UNEXPECTED_ERROR`); como não dá para pedir outra
  leitura, a tela oferece "Tentar de novo", que tira a conexão e abre outra autorização. Não precisa do script do Pluggy Connect nem de mudança no CSP.
- O conector 200 é o `MeuPluggy` (`PERSONAL_BANK`, `oauth: true`, sem credenciais). Ele marca
  `isOpenFinance: false` por ser um repasse, mas os dados por baixo são Open Finance.
- `POST /auth` devolve um `apiKey` (JWT) que vale **2 h**. `POST /connect_token` recusa
  localhost ("must be a valid HTTPS URL (not localhost) or a valid deep link").
- `GET /items` (listar) responde **401**, então o Capital guarda os ids dos itens que ele cria.
  `PATCH /items/{id}` responde **400 "MeuPluggy item cant be updated"**: não dá para forçar a
  atualização.
- No item, `lastUpdatedAt` é a última sincronização do Meu Pluggy com o banco (pode ser anterior à
  criação do item), `nextAutoSyncAt` cai ~24 h depois e `consentExpiresAt` fica 1 ano após a
  autorização. Também vêm `autoSyncDisabledAt`, `consecutiveFailedLoginAttempts`,
  `hasResourcesPendingAuthorization` e `resourcesCollectedAt`.
- **O nome do banco não vem no item**: o conector é sempre "MeuPluggy". Conta bancária traz `name`
  ("BTG Banking", "Nu Pagamentos S.A. …") e o código do banco no começo de
  `bankData.transferNumber` (208, 260). Um cartão sozinho traz só o nome do cartão ("AMAZON
  MASTERCARD PLATINUM"). O Capital sugere o nome e a pessoa edita.
- `GET /v2/transactions` pagina por `next`. `page`/`pageSize` respondem **400**, e a v1
  (`/transactions`) responde **410** `ENDPOINT_DEPRECATED`. A primeira leitura traz **~12 meses**.
- Campos das transações:
  - sempre preenchidos nos três bancos: `description`, `descriptionRaw`, `category`, `operationType`
    e `paymentData.paymentMethod` (este, nas contas);
  - quase sempre vazio: `merchant`;
  - nunca preenchido: `balance` (o saldo depois da transação);
  - pagador e recebedor vêm com documento (CPF/CNPJ) muito mais vezes do que com nome.
- **Cartão:**
  - compra: valor positivo, `type: DEBIT`;
  - pagamento de fatura: negativo, `CREDIT`, `operationType: PAGAMENTO_FATURA` e categoria
    "Credit card payment";
  - estorno: negativo, `operationType: ESTORNO`;
  - parcelada: os três mandaram juntos `installmentNumber`, `totalInstallments` e `purchaseDate`.
  - `PENDING` no cartão quer dizer "ainda sem fatura fechada" (`billId` vazio). Num cartão era a
    maioria, inclusive compras antigas: não trate como "vai virar POSTED logo".
- Pistas para separar o que não é gasto: `TRANSFERENCIA_MESMA_INSTITUICAO` e a categoria "Same
  person transfer" (entre contas próprias); `APLICACAO_FINANCEIRA`, `RESGATE_APLIC_FINANCEIRA` e
  `RENDIMENTO_APLIC_FINANCEIRA` (investimento); `PORTABILIDADE_SALARIO` (salário portado);
  `TARIFA_SERVICOS_AVULSOS` (tarifa).
- `GET /bills` só traz faturas **fechadas**, com os pagamentos de cada uma. `GET /investments`
  traz ações, FIIs, Tesouro, CDB, LCI e LCA com `name` e `balance`; `institution` vem vazio. No
  BTG, os 67 investimentos vieram com `code` (o ticker, nas ações e nos FIIs) e `quantity`.

### Lógica de negócio pura (`/lib/budget`)

Todas as fórmulas da seção 6 do briefing (proportionalFixed, available, remaining,
usedPct, rollover, validação de percentuais) estão implementadas em módulos puros —
`calculations.ts`, `rollover.ts`, `validation.ts` — que não importam React nem a camada
de storage. Isso os torna triviais de testar (`lib/budget/__tests__`, ver seção
"Testes") e reutilizáveis por qualquer UI ou backend.

`money.ts` cuida de arredondamento (evitando erros de ponto flutuante) e formatação em
`R$ 1.234,56`. `date.ts` cuida da aritmética de meses (`YYYY-MM`), da data de hoje no fuso
local e dos rótulos em português.

### Camada de dados

Toda a UI e toda a lógica de negócio falam **apenas** com a interface `BudgetRepository`
(`lib/storage/repository.ts`):

```ts
interface BudgetRepository {
  getSettings(): Promise<BudgetSettings>;
  saveSettings(settings: BudgetSettings): Promise<void>;
  listMonths(): Promise<Month[]>;
  getMonth(month: Month): Promise<MonthData | undefined>;
  ensureMonth(month: Month): Promise<MonthData>;
  saveIncome(month, income): Promise<void>;
  deleteIncome(month, incomeId): Promise<void>;
  saveExpense(month, expense): Promise<void>;
  deleteExpense(month, expenseId): Promise<void>;
  closeMonth(month, openNext?): Promise<void>;
  reopenMonth(month): Promise<void>;
  exportData(): Promise<BackupPayload>;
  importData(payload): Promise<void>;
  clearAll(): Promise<void>;
}
```

- **No navegador**, a implementação é o **`HttpBudgetRepository`**
  (`lib/storage/httpRepository.ts`). Cada método é uma chamada à API do próprio app
  (`/api/v1/...`, mesma origem, cookie de sessão).
- **No servidor**, os Route Handlers validam a entrada (Zod), exigem sessão e usam o
  **`PostgresBudgetRepository`** (`lib/server/budgetRepository.ts`), sempre com o id do usuário
  logado. É aí que se garante o isolamento entre contas.
- **No banco**, cada mês é uma linha em `months` mais os lançamentos em `incomes` e `expenses`.
  O repositório remonta o mesmo `MonthData` de sempre, então `computeMonthSummary`,
  `createMonthData` e `cascadeCarryIn` são reaproveitados sem alteração.
- **Nas escritas**, cada gravação num mês roda numa transação com trava por usuário
  (`pg_advisory_xact_lock`) e recalcula em cascata o `carryIn` dos meses seguintes; o mesmo vale
  ao reabrir ou apagar um mês.
- **Fechar o mês** (`closeMonth(month, true)`) congela a competência e abre a seguinte na mesma
  transação, já com a sobra de cada categoria como `carryIn`. **Só um mês fechado passa sobra**
  (`carrySource`): de um mês aberto ou reaberto, o seguinte recebe zero, mesmo que já esteja em uso.
  A tela mostra a prévia e pergunta se a sobra vem junto; com "Não trazer",
  `closeMonth(month, openNext, true)` grava `leftovers_dropped` no mês fechado. Reabrir apaga a
  resposta, tira a sobra do mês seguinte e a pergunta é feita de novo no próximo fechamento.
- **Os botões da virada do mês** (`useMonthsToClose`) só aparecem no mês de hoje e olham os meses
  guardados antes dele (`monthsToClose`). Com mais de um aberto, **Fechar todos os meses anteriores**
  (`closeMonthsBefore`) fecha todos de uma vez: cada um passa a sobra para o seguinte, a tela mostra
  o que chegaria ao fim e a resposta vale para o mês de hoje, gravada só no último mês antes dele.
  Enquanto esses botões aparecem, o "Fechar mês" do fim da tela some, para não fechar o mês que
  acabou de começar por engano.
- **Contas que já existiam:** `carryOnCloseMigration` recalcula uma vez todos os meses de todas as
  contas. Meses abertos deixam de passar sobra, e fechá-los com "Trazer" devolve os mesmos números.
  Restaurar um backup antigo faz o mesmo recálculo.

**`IndexedDbBudgetRepository`** (Dexie.js) continua no código, mas só para a importação única
dos dados locais da versão v1 (`lib/storage/localMigration.ts`), oferecida por um banner e na
tela de Configurações.

### Autenticação

- **Login:** e-mail e senha com **Better Auth** (`lib/server/auth.ts`). As sessões ficam no
  próprio Postgres, com confirmação de e-mail e redefinição de senha; os e-mails saem pelo SMTP do
  Gmail (`lib/server/mailer.ts`).
- **Rotas:** as telas ficam no route group `app/(app)/`, que é protegido. `/login`, `/auth/*` e
  `/redefinir-senha` ficam fora.
- **Checagem da sessão:** `proxy.ts` (o antigo `middleware.ts`, renomeado no Next.js 16) só
  confere se existe cookie de sessão. O layout autenticado e cada rota da API validam a sessão
  de fato.
- **Operações de login:** são Server Actions (`lib/auth/actions.ts`), com limite de tentativas.

### Preferências leves (`lib/storage/preferences.ts`)

Apenas tema (claro/escuro/sistema) e o último mês visualizado usam `localStorage`,
conforme pedido — nunca dados financeiros.

## PWA e offline

- `public/manifest.json` — instalável, ícones 192/512 (`any` e `maskable`).
- `public/sw.js` — service worker escrito à mão, registrado por
  `components/pwa/RegisterServiceWorker.tsx` apenas em produção. Também mostra as notificações
  (`push`), executa os botões delas (`notificationclick`) e reinscreve o aparelho quando o
  navegador troca a inscrição (`pushsubscriptionchange`). No `npm run dev` ele só é registrado
  ao ativar as notificações, como `/sw.js?dev=1`, sem cache.
- Notificações: Configurações → Notificações ativa o aparelho (a permissão só é pedida num
  toque), manda um teste e lista os aparelhos. No Brave, ative antes "Usar os serviços do Google
  para mensagens push" em `brave://settings/privacy`.
  - Estratégias de cache: cache-first para os assets do Next com hash no nome, network-first com
    fallback para navegação e stale-while-revalidate para o restante.
  - Mantém o _app shell_ disponível offline.
  - As chamadas à API (`/api/*`) vão sempre direto à rede e nunca passam pelo cache, então nenhum
    dado velho é servido.
  - Sem rede, o app abre mas fica em "Carregando…". Um cache write-through no IndexedDB com
    sincronização é o próximo passo natural, ainda não implementado.
- `public/offline.html` — página de fallback quando uma rota nunca visitada é aberta
  sem rede.

> Nota: os ícones em `/public/icon-*.png` foram gerados por
> `scripts/generate-icons.mjs` como placeholder de marca (`node scripts/generate-icons.mjs`
> para regenerar). Troque por assets de marca reais antes de publicar.

## Testes

### Testes automáticos no servidor (Administração)

Além dos testes do código, o próprio servidor se testa (`lib/server/selfTest`): uns 4 minutos
depois de ligar, depois de hora em hora e quando o dono toca em **Rodar agora**, no topo de
Administração. São cerca de 30 testes, pelo menos um por módulo (o `Record` de `catalog.ts`
não compila se um módulo novo ficar sem teste) e os do servidor:

- **Cada módulo, de verdade, no banco de produção:** cada teste cria uma conta descartável e
  faz o que a tela faria — lança renda e gasto, fecha mês, monta fatura com parcela, lança conta
  do mês, aporta no Diagrama, confere banco, marca lembrete, ganha XP… — pelos mesmos
  repositórios, numa transação que é **sempre desfeita** no fim. Nada fica: nem a conta, nem uma
  linha (`statement_timeout` de 15 s em cada transação).
- **O que roda sozinho está em dia:** a agenda de cada minuto e a leitura dos bancos (de hora em
  hora); a chave `ENCRYPTION_KEY` ainda abre os segredos guardados;
  migrações aplicadas, disco, SMTP e chaves VAPID.
- **Serviços de fora** (B3, Yahoo, Fundamentus): quando não respondem é **aviso**
  (amarelo), não falha — o conserto não está no código.

Cada rodada fica em `self_test_runs` (as últimas 100). Um teste que **passa a falhar** avisa o
dono pelo sino e no celular (`notifyOwner`, como os outros alertas do servidor), uma vez só: se
continuar falhando na hora seguinte, não repete. O ícone de Administração na bandeja de apps
mostra os avisos do servidor não lidos. `lib/server/__tests__/selfTest.test.ts` roda todos eles
num banco em memória: num banco certo nada falha e nada sobra; com uma tabela quebrada o teste do
módulo falha.

### Testes do código

`npm test` roda os cenários de aceitação da seção 9 do briefing como testes unitários de
`/lib/budget` (Vitest): mês isolado sem rollover, rollover positivo/negativo, fechamento e
carga do mês seguinte, gasto no cartão (`cardTotal`), validação de soma de percentuais e o
estado `available <= 0`.

Os demais testes:
- **`lib/budget/__tests__/wallet-fixtures.test.ts`:** as fixtures de parcelados, reserva e caixa
  da mesma planilha (dívida dos parcelados −3.093,20, gap da reserva 3.195,80).
- **`lib/server/__tests__/walletRepository.test.ts`:** a Carteira contra o banco (PGlite):
  parcelas nos meses abertos e na prévia, nunca em mês fechado nem duplicadas, exclusão de
  plano, remanejar (guardar e retirar, com o estorno na categoria e o limite de cotas), uma
  compra parcelada de antes da conta sem mexer nos meses passados, adiantar parcelas (a compra
  encurta e o pagamento entra no mês) e caixa.
- **`lib/budget/__tests__/reserve.test.ts`:** o plano da reserva calculado a partir do que foi
  lançado (duas parcelas no mesmo mês somam, um mês pulado só adia, centavos não deixam o plano
  eternamente a R$ 0,004 do fim) e o "A receber" com quem já pagou, que não mexe em nenhum número
  do orçamento nem da fatura.
- **`lib/budget/__tests__/installments.test.ts`:** as parcelas que saem de um parcelamento sem
  nada de errado — as já pagas antes do cadastro e as adiantadas — sumindo ao mesmo tempo da
  fatura, do orçamento, da dívida e dos meses que a compra pode tocar; e a categoria "Fora do
  orçamento", que entra na fatura e em nenhuma categoria.
- **`lib/budget/__tests__/fixtures.test.ts`:** as fixtures reais da planilha em 15/09/2026
  (§9 da spec do assistente), com tolerância de R$ 0,01 — a planilha não arredonda entre as
  etapas e o Capital arredonda cada uma. Inclui as regras da categoria "A receber".
- **`lib/server/__tests__/budgetRepository.test.ts`:** cobre o repositório Postgres contra o
  schema e as migrações reais, num Postgres em memória (PGlite). Casos: seed, cascata de
  rollover, mês fechado/inexistente, fechar abrindo o mês seguinte, fechar sem trazer a sobra,
  apagar mês, export→import,
  módulos, áreas da Início e avisos vistos por usuário (e no backup, inclusive os antigos com
  rodapé), isolamento entre contas e escritas
  simultâneas.
- **Componentes** (`components/**/__tests__`, Testing Library): o formulário de gasto com a
  categoria "A receber" e sem o módulo Cartão, a prévia do "Fechar mês" e o botão da virada do mês.
- **`lib/reminders/__tests__/schedule.test.ts`:** os lembretes com relógio falso em São Paulo:
  mês curto, vários dias da semana, aviso antecipado, repetição até "Realizado", atrasados,
  horários do usuário, tarefas agrupadas e o que não dispara antes da criação.
- **`lib/server/__tests__/reminders.test.ts` e `push.test.ts`:** a agenda contra o banco (envia no
  minuto certo, nunca duas vezes, recupera o que perdeu fora do ar, só para quem ligou o módulo),
  o token do "Realizado" (válido, expirado e adulterado) e os aparelhos (404/410 apaga).
- **`lib/categoryText/__tests__/categories.test.ts`:** as categorias de cada conta e achar uma delas
  num texto, sem ligar para maiúsculas, acentos e plural, com os sinônimos de "A receber".
- **`lib/server/__tests__/moduleAccess.test.ts` e `lib/modules/__tests__/flags.test.ts`:** o
  "Restrito" da Administração: o padrão (Open Finance), a escolha do dono
  módulo por módulo, todo o resto ligado para todo mundo, o módulo que vira restrito sumindo para
  quem não tem acesso (e os que dependem dele) sem apagar nada, o que volta a ser de todos na hora,
  a conta que perde ou ganha o acesso, a conta modelo, o acerto a cada subida (`syncModules`) e o
  404 sem nome do servidor. `ModuleGate.test.tsx`: quem não tem acesso não vê o módulo restrito,
  nem o que depende dele. `modulesAlwaysOn.test.ts`: a Início guardada como estava, a Início do
  modelo (ou do dono) para todos uma vez só, e a conta nova partindo dela.
- **`lib/server/__tests__/pluggy.test.ts`, `banksSync.test.ts` e `lib/banks/__tests__`:** o Open
  Finance, com a Pluggy simulada nas respostas que ela dá de verdade. Cobrem:
  - a sincronização: um ano na primeira leitura, só "chegou algo?" enquanto o banco não manda
    nada, 7 dias para trás depois, a pendente que vira confirmada sem duplicar e sem perder o que
    a pessoa decidiu, `UPDATING`, item sumido, leitura sem contas e duas leituras ao mesmo tempo;
  - o job: só quem pode usar o módulo, uma vez por hora, e uma falha não para
    ninguém;
  - "Parado" depois de 48 h, o aviso de autorização e os saldos guardados só no servidor (a tela
    recebe só o nome e o tipo de cada conta);
  - a conferência do mês (`banksReview.test.ts`, com a data fixa em 21/10/2026): os dois jeitos de
    os bancos mandarem as parcelas (gravados do formato real), a virada de mês, o par forte × o
    fraco, a compra parcelada que bate com um plano (o número da parcela do Capital), o mês
    anterior aceito e o mais antigo recusado, Ignorados e "Voltar para conferir";
  - os cartões: compra lançada à mão sem cartão, em outro cartão, lançada à vista que no banco é
    parcelada ("Trocar por parcelado" numa gravação só), cartão sem ligação, "Não informar", mês
    fechado recusando "Pôr no…", e que nenhuma resposta leva saldo, fatura ou limite do banco;
  - os avisos: só o que é novo e falta no Capital, nada quando já confere, as escolhas antigas
    convertidas e o "Aviso silencioso" chegando ao push;
  - a paginação por `next`, inclusive um `next` que aponta para fora da Pluggy;
  - a chave: conferida antes de salvar, cifrada, e só o fim do Secret volta;
  - trazer um banco: o corpo do `POST /items`, a espera pelo link e o `pending`;
  - os limites: sem https, as 5 conexões e sem chave;
  - a chegada das contas, com o nome sugerido, e o nome dado pela pessoa, que fica;
  - a autorização largada, apagada aqui e na Pluggy, e a conexão que caiu;
  - tirar um banco, desconectar tudo e "Apagar todos os dados";
  - os nomes sugeridos e o "há 5 h".
- **`lib/modules/__tests__`:** o catálogo, todos os módulos ligados (e o que depende de um
  restrito sumindo junto), Missões no topo, a bandeja de apps, as áreas da Início
  (padrão, a ordem antiga, widget novo, repetidos, áreas vazias, mover, pôr, tirar, criar e excluir
  área) e os tours (todo módulo tem tour e botão de ajuda, e toda âncora existe nas telas).
- **`lib/gamification/__tests__` e `lib/server/__tests__/missions.test.ts`:** as Missões — XP fixo
  e uma vez por período (dia, semana ISO, mês, uma vez), pela data do servidor, nada por valor nem
  por resultado, só missões que a conta tem (restritos e condicionais), visitas só de missões de
  "ir até o lugar", a conta modelo sem XP, "Apagar todos os dados" zerando, o que cada tela conta,
  a ordem na Início e os níveis.
- **`lib/budget/__tests__/topics.test.ts`, `components/settings/__tests__` e
  `components/onboarding/__tests__`:** as categorias padrão e suas descrições, restaurar o padrão
  (inclusive com dados antigos, sem `preset`), nunca apagar uma categoria, a arquivada no mês atual,
  nos próximos e nos passados, o editor sem "Excluir" e com os avisos, e a configuração das
  categorias em 3 passos (inclusive criando uma categoria com descrição).
- **Repositório HTTP** (`lib/storage/__tests__`).
- O **limitador de tentativas** de login, e a conta de teste do primeiro acesso, que só vale para
  e-mail `.test`.

## Checklist de aderência

### Fórmulas (seção 6)

- [x] `proportionalFixed(t) = (fixedTotal + unforeseenTotal) * pct(t)`
- [x] `available(t) = incomeTotal * pct(t) - proportionalFixed(t) + carryIn(t)`
- [x] `remaining(t) = available(t) - spent(t)`
- [x] `usedPct(t) = spent(t) / available(t)`, mostrando "—" e estado de alerta quando `available(t) <= 0`
- [x] Rollover: `carryIn` do mês N = `remaining` do mês N-1 (inclusive negativo)
- [x] Fechar mês congela os números; reabrir recalcula em cascata os meses seguintes
- [x] `topicsSnapshot` guarda o `pct` vigente em cada mês (config posterior não altera meses passados)
- [x] Validação: soma dos `targetPct` ativos deve ser 100%, com indicação do quanto falta/sobra

### Telas (seção 7)

- [x] **Início** — painel com um card por módulo, seletor de mês, FAB "+ Lançar gasto" e "+ Renda"
- [x] **Categorias do mês** — cabeçalho com renda/gasto/posso-gastar/saldo, card por categoria com barra de progresso (verde/amarelo/vermelho), card de custos fixos/imprevistos com rateio por categoria e "Fechar mês"
- [x] **Detalhe da categoria** — lista de gastos editável/excluível e a conta completa (`renda × pct − rateio + mês passado = posso gastar`)
- [x] **Lançamentos do mês** — abas Gastos / Renda / Custos Fixos / Imprevistos, busca e edição/exclusão inline
- [x] **Histórico & Gráficos** — abas Gastos (mês contra a média, categorias do mês, cada categoria mês a mês com gasto/limite e sobra) e Investimentos (com o Diagrama: subida e descida da carteira por período, por tipo e por ativo)
- [x] **Configurações** — exportar/importar JSON, apagar tudo, tema claro/escuro, conta (e-mail + sair), importar dados locais. O editor de categorias (nome/descrição/%/ordem/arquivar, validador de 100% e restaurar padrão) fica na engrenagem de Categorias
- [x] **Login** — entrar / criar conta / esqueci a senha, com confirmação de e-mail

### Requisitos não-funcionais (seção 8)

- [x] Alvos de toque ≥ 44px; campo de valor com teclado numérico (`inputMode="decimal"`)
- [~] Dados no Postgres próprio do Orange Pi, isolados por usuário na API; o app precisa de conexão para ler/gravar (cache offline é trabalho futuro)
- [x] Lançar um gasto em ≤ 3 toques (categoria → descrição opcional → salvar) além do valor
- [x] Labels em todos os inputs, navegação por teclado, contraste AA nas cores de status

### Fora do escopo v1, preparado no schema (seção 11)

- [x] `Expense.installmentPlan?: InstallmentPlan` reservado para cartão parcelado — não usado por nenhum cálculo nem tela da v1
- [x] `BudgetRepository` não assume um único usuário nem armazenamento local — a troca do Supabase pelo Postgres próprio mudou só a instância em `lib/storage/index.ts`
