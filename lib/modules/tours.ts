import type { ModuleKey, Month } from '../budget/types';

/** A sheet the tour opens for a step (and closes when it moves on). */
export type TourSheet = 'expense-form' | 'expense-form-reimbursable';

/** One stop of a module's tour. */
export interface TourStepDefinition {
  /** The screen the step happens on. */
  route: (month: Month) => string;
  /** The `data-tour` anchor it highlights. It must exist even in an account with no data. */
  anchor: string;
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Opened before the step is shown, e.g. the expense form for the card question. */
  sheet?: TourSheet;
  /** Only shown while this other module is on (its part of the screen only exists then). */
  requires?: ModuleKey;
}

const home = (month: Month) => `/mes/${month}`;
const entries = (month: Month) => `/mes/${month}/lancamentos`;
const categories = (month: Month) => `/mes/${month}/categorias`;
const card = () => '/cartao';

/**
 * The tour of every module (a `Record`, so a module without a tour does not compile): at most four
 * steps, each with a one-line description (a test holds both). Steps point at the module's own
 * screen (or its widget on the Início, which the Início brings into view), never at the up-arrow
 * or the trays of the Início, which are not the module's. Every tour then ends on its help button.
 */
export const MODULE_TOURS: Record<ModuleKey, TourStepDefinition[]> = {
  missions: [
    {
      route: () => '/missoes',
      anchor: 'missoes-nivel',
      title: 'Seu nível',
      description: 'Cada missão dá XP. Com XP, a sua árvore cresce de nível.',
      side: 'bottom',
    },
    {
      route: () => '/missoes',
      anchor: 'missoes-lista',
      title: 'Missões',
      description: 'Toque numa missão e o app leva você até o lugar certo.',
      side: 'top',
    },
  ],
  expenses: [
    {
      route: entries,
      anchor: 'lancamentos-abas',
      title: 'Tudo o que entrou e saiu',
      description: 'Gastos e rendas do mês. Toque num para editar.',
      side: 'bottom',
    },
    {
      route: entries,
      anchor: 'lancamentos-busca',
      title: 'Busca e filtro',
      description: 'Procure pela descrição ou filtre por categoria e por tag, como #Mercado.',
      side: 'bottom',
    },
    {
      route: entries,
      anchor: 'fab-lancar-gasto',
      title: 'Lançar gasto',
      description: 'Toque aqui sempre que gastar: valor, categoria e pronto.',
      side: 'top',
    },
    {
      route: entries,
      anchor: 'fab-renda',
      title: 'Registrar renda',
      description: 'Salário, freela ou qualquer dinheiro que entrou.',
      side: 'top',
    },
  ],
  budget: [
    {
      route: categories,
      anchor: 'categorias',
      title: 'Suas 4 metas',
      description: 'Cada categoria recebe uma % da renda. Toque para ver.',
      side: 'top',
    },
    {
      route: categories,
      anchor: 'custos-fixos',
      title: 'Custos fixos e imprevistos',
      description: 'Saem de cada categoria, na proporção da %.',
      side: 'top',
    },
    {
      route: categories,
      anchor: 'fechar-mes',
      title: 'Fechar o mês',
      description: 'A sobra só vai para o mês seguinte quando o mês é fechado.',
      side: 'top',
    },
  ],
  card: [
    {
      route: card,
      anchor: 'cartao-fatura',
      title: 'A fatura do mês',
      description: 'Quanto vem e quando vence. Sai só com Fatura paga.',
      side: 'bottom',
    },
    {
      route: () => `${card()}?aba=parcelados`,
      anchor: 'cartao-aba-parcelados',
      title: 'Parcelados',
      description: 'O que falta de cada compra parcelada.',
      side: 'bottom',
    },
    {
      route: () => `${card()}?aba=cartoes`,
      anchor: 'cartao-aba-cartoes',
      title: 'Seus cartões',
      description: 'Nome, vencimento e aviso de cada cartão.',
      side: 'bottom',
    },
    {
      route: home,
      anchor: 'cartao-pergunta',
      title: 'Foi no cartão?',
      description: 'Ao lançar um gasto, toque em Cartão se foi no crédito.',
      side: 'bottom',
      sheet: 'expense-form',
    },
  ],
  reimbursable: [
    {
      route: home,
      anchor: 'categoria-a-receber',
      title: 'Uma compra para outra pessoa',
      description: 'Use quando alguém vai te devolver o dinheiro.',
      side: 'top',
      sheet: 'expense-form-reimbursable',
    },
    {
      route: (month) => `${entries(month)}?aba=a-receber`,
      anchor: 'aba-a-receber',
      title: 'O filtro A receber',
      description: 'Em Lançamentos, veja quem ainda precisa te pagar.',
      side: 'bottom',
    },
    {
      route: home,
      anchor: 'card-reimbursable',
      title: 'Quanto volta para você',
      description: 'O total que ainda te devem. Não é gasto seu.',
      side: 'top',
    },
  ],
  history: [
    {
      route: () => '/historico?aba=gastos',
      anchor: 'historico-mes',
      title: 'Mês a mês',
      description: 'Gasto e renda. Toque numa barra para ver o mês.',
      side: 'bottom',
    },
    {
      route: () => '/historico?aba=gastos',
      anchor: 'historico-categorias',
      title: 'Cada categoria',
      description: 'Quanto você gastou do limite de cada uma no mês escolhido.',
      side: 'top',
    },
    {
      route: () => '/historico?aba=gastos',
      anchor: 'historico-evolucao',
      title: 'Ao longo do tempo',
      description: 'O gasto ou a sobra de cada categoria, mês a mês.',
      side: 'top',
    },
    {
      route: () => '/historico?aba=investimentos',
      anchor: 'historico-investimentos',
      title: 'Seus investimentos',
      description: 'Como a carteira subiu e desceu. Filtre por tipo.',
      side: 'bottom',
      requires: 'diagram',
    },
  ],
  recurring: [
    {
      route: () => '/carteira/recorrentes',
      anchor: 'recorrentes-lista',
      title: 'As contas do mês',
      description: 'O que falta lançar vem primeiro.',
      side: 'bottom',
    },
    {
      route: () => '/carteira/recorrentes',
      anchor: 'recorrentes-mes',
      title: 'Outro mês',
      description: 'Deslize para ver as contas de outro mês.',
      side: 'bottom',
    },
    {
      route: () => '/carteira/recorrentes',
      anchor: 'recorrentes-novo',
      title: 'Nova conta',
      description: 'Valor, categoria, dia do vencimento e se é paga no cartão.',
      side: 'bottom',
    },
    {
      route: () => '/carteira/recorrentes',
      anchor: 'recorrentes-config',
      title: 'Aviso no celular',
      description: 'Na engrenagem, o horário do aviso.',
      side: 'bottom',
    },
  ],
  cash: [
    {
      route: () => '/carteira/caixa',
      anchor: 'caixa-gap',
      title: 'Sua reserva',
      description: 'Quanto você tem e quanto falta para a meta.',
      side: 'bottom',
    },
    {
      route: () => '/carteira/caixa',
      anchor: 'caixa-detalhes',
      title: 'Ver detalhes',
      description: 'Em conta, investida e as dívidas do cartão.',
      side: 'bottom',
    },
    {
      route: () => '/carteira/caixa?aba=investida',
      anchor: 'reserva-valor',
      title: 'Reserva investida',
      description: 'Suas cotas e a cotação de hoje.',
      side: 'bottom',
    },
    {
      route: () => '/carteira/caixa',
      anchor: 'caixa-config',
      title: 'Configurar a reserva',
      description: 'Na engrenagem, a meta e o ativo das cotas.',
      side: 'bottom',
    },
  ],
  diagram: [
    {
      route: () => '/diagrama',
      anchor: 'diagrama-valor',
      title: 'Quanto você quer investir?',
      description: 'Digite o valor e toque em Calcular.',
      side: 'bottom',
    },
    {
      route: () => '/diagrama',
      anchor: 'diagrama-carteira',
      title: 'Sua carteira por tipo',
      description: 'Quanto cada tipo pesa hoje e a meta dele.',
      side: 'top',
    },
    {
      route: () => '/diagrama?aba=ativos',
      anchor: 'diagrama-ativos',
      title: 'Ativos e notas',
      description: 'Nota de −10 a 10: quanto maior, mais ele recebe.',
      side: 'top',
    },
    {
      route: () => '/diagrama',
      anchor: 'diagrama-config',
      title: 'Tipos e metas',
      description: 'Na engrenagem, quanto cada tipo deve pesar.',
      side: 'bottom',
    },
  ],
  reminders: [
    {
      route: () => '/lembretes',
      anchor: 'lembretes-abas',
      title: 'Hoje, Todos e Calendário',
      description: 'O que vence hoje. Toque no círculo quando fizer.',
      side: 'bottom',
    },
    {
      route: () => '/lembretes',
      anchor: 'lembretes-novo',
      title: 'Novo lembrete',
      description: 'Uma vez ou repetindo, no horário que quiser.',
      side: 'top',
    },
    {
      route: () => '/lembretes',
      anchor: 'lembretes-config',
      title: 'Avisos no celular',
      description: 'Na engrenagem você ativa as notificações neste aparelho.',
      side: 'bottom',
    },
  ],
  banks: [
    {
      route: () => '/bancos',
      anchor: 'bancos-conexoes',
      title: 'Seus bancos',
      description: 'Traga seus bancos e confira o mês aqui.',
      side: 'bottom',
    },
    {
      route: () => '/bancos',
      anchor: 'bancos-uma-vez-por-dia',
      title: 'Uma vez por dia',
      description: 'Os bancos mandam os dados uma vez por dia.',
      side: 'top',
    },
    {
      route: () => '/bancos',
      anchor: 'bancos-config',
      title: 'Avisos e chave',
      description: 'Na engrenagem, os avisos e a sua chave.',
      side: 'bottom',
    },
  ],
};

/**
 * Where each module's help button is (`data-tour="ajuda-<module>"`): the header of its screen,
 * or the place a module without a screen shows up. Every tour ends there, so the person learns
 * how to see it again.
 */
export const MODULE_HELP: Record<ModuleKey, Pick<TourStepDefinition, 'route' | 'sheet'>> = {
  missions: { route: () => '/missoes' },
  expenses: { route: entries },
  budget: { route: categories },
  card: { route: card },
  reimbursable: { route: (month) => `${entries(month)}?aba=a-receber` },
  history: { route: () => '/historico' },
  recurring: { route: () => '/carteira/recorrentes' },
  cash: { route: () => '/carteira/caixa' },
  diagram: { route: () => '/diagrama' },
  reminders: { route: () => '/lembretes' },
  banks: { route: () => '/bancos' },
};

export const helpAnchor = (key: ModuleKey) => `ajuda-${key}`;

export interface TourStep extends Omit<TourStepDefinition, 'route'> {
  href: string;
  /** The module the step explains; none for the Início's own tour (organizing the telas). */
  module?: ModuleKey;
}

/**
 * The steps of these modules' tours, one after the other, with the routes for `month`, leaving out
 * the steps whose other module is off (`isOn`). Each module's part ends on its help button.
 */
export function tourSteps(
  keys: ModuleKey[],
  month: Month,
  isOn: (key: ModuleKey) => boolean = () => true,
): TourStep[] {
  return keys.flatMap((key) => [
    ...MODULE_TOURS[key]
      .filter((step) => !step.requires || isOn(step.requires))
      .map(({ route, ...step }) => ({ ...step, href: route(month), module: key })),
    {
      href: MODULE_HELP[key].route(month),
      sheet: MODULE_HELP[key].sheet,
      anchor: helpAnchor(key),
      title: 'Ficou alguma dúvida?',
      description: 'Toque aqui quando quiser ver esta explicação de novo.',
      side: 'bottom' as const,
      module: key,
    },
  ]);
}

/** The help button next to the pencil of the Início, where its tour ends. */
export const HOME_HELP_ANCHOR = 'ajuda-inicio';

/**
 * "Como organizar a Início": the Início is put in edit mode first, then this walks through the
 * real controls — the widget to hold and drag (and its − and Mover), the widget tray and the ✓.
 * Same rules as a module's tour: at most four steps, one line each, then the help button.
 */
export const HOME_EDIT_TOUR: Omit<TourStepDefinition, 'route'>[] = [
  {
    anchor: 'inicio-widget',
    title: 'Segure e arraste',
    description: 'Segure um widget e arraste para mudar de lugar.',
    side: 'bottom',
  },
  {
    anchor: 'inicio-widget',
    title: 'Tirar ou mover',
    description: 'O − tira o widget; Mover leva para outra tela.',
    side: 'bottom',
  },
  {
    anchor: 'inicio-bandeja',
    title: 'Bandeja de widgets',
    description: 'Os que você tirou ficam aqui. Toque para voltar.',
    side: 'top',
  },
  {
    anchor: 'inicio-concluir',
    title: 'Pronto',
    description: 'Toque aqui quando terminar.',
    side: 'bottom',
  },
];

/** The Início's tour on the screen it is on (`href`, the Início's own address), ending on its help. */
export function homeEditTourSteps(href: string): TourStep[] {
  return [
    ...HOME_EDIT_TOUR.map((step) => ({ ...step, href })),
    {
      href,
      anchor: HOME_HELP_ANCHOR,
      title: 'Ficou alguma dúvida?',
      description: 'Toque aqui quando quiser ver esta explicação de novo.',
      side: 'bottom' as const,
    },
  ];
}
