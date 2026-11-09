import type { ModuleKey } from '../core/types';

/** A sheet the tour opens for a step (and closes when it moves on). None yet. */
export type TourSheet = never;

/** One stop of a module's tour. */
export interface TourStepDefinition {
  /** The screen the step happens on. */
  route: () => string;
  /** The `data-tour` anchor it highlights. It must exist even in an account with no data. */
  anchor: string;
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Opened before the step is shown. */
  sheet?: TourSheet;
  /** Only shown while this other module is on (its part of the screen only exists then). */
  requires?: ModuleKey;
}

/**
 * The tour of every module (a `Record`, so a module without a tour does not compile): at most four
 * steps, each with a one-line description (a test holds both). Steps point at the module's own
 * screen (or its widget on the Início, which the Início brings into view), never at the up-arrow
 * or the trays of the Início, which are not the module's. Every tour then ends on its help button.
 */
export const MODULE_TOURS: Record<ModuleKey, TourStepDefinition[]> = {
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
  history: [
    {
      route: () => '/historico',
      anchor: 'historico-investimentos',
      title: 'Seus investimentos',
      description: 'Como a carteira subiu e desceu. Filtre por tipo.',
      side: 'bottom',
    },
  ],
  banks: [
    {
      route: () => '/bancos',
      anchor: 'bancos-conexoes',
      title: 'Suas corretoras',
      description: 'Traga suas corretoras e confira o Diagrama aqui.',
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
      title: 'Sua chave',
      description: 'Na engrenagem, a sua chave da Pluggy.',
      side: 'bottom',
    },
  ],
};

/**
 * Where each module's help button is (`data-tour="ajuda-<module>"`): the header of its screen.
 * Every tour ends there, so the person learns how to see it again.
 */
export const MODULE_HELP: Record<ModuleKey, Pick<TourStepDefinition, 'route' | 'sheet'>> = {
  diagram: { route: () => '/diagrama' },
  history: { route: () => '/historico' },
  banks: { route: () => '/bancos' },
};

export const helpAnchor = (key: ModuleKey) => `ajuda-${key}`;

export interface TourStep extends Omit<TourStepDefinition, 'route'> {
  href: string;
  /** The module the step explains; none for the Início's own tour (organizing the telas). */
  module?: ModuleKey;
}

/**
 * The steps of these modules' tours, one after the other, leaving out the steps whose other module
 * is off (`isOn`). Each module's part ends on its help button.
 */
export function tourSteps(
  keys: ModuleKey[],
  isOn: (key: ModuleKey) => boolean = () => true,
): TourStep[] {
  return keys.flatMap((key) => [
    ...MODULE_TOURS[key]
      .filter((step) => !step.requires || isOn(step.requires))
      .map(({ route, ...step }) => ({ ...step, href: route(), module: key })),
    {
      href: MODULE_HELP[key].route(),
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
