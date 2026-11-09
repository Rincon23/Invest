import { describe, expect, it } from 'vitest';
import type { BudgetSettings, HomeWidgetKey, ModuleKey } from '../../budget/types';
import {
  MAX_HOME_PAGES,
  addHomePage,
  addWidget,
  deleteHomePage,
  hiddenHomeCards,
  homeCards,
  moveWidget,
  pageOfWidget,
  removeWidget,
  resolveHomePages,
  withoutEmptyPages,
} from '../home';
import { MODULE_KEYS } from '../catalog';

/** Only these modules (the rest saved off, as for a restricted module). */
const on = (...keys: ModuleKey[]) => Object.fromEntries(MODULE_KEYS.map((key) => [key, keys.includes(key)]));
const everything = on(
  'missions',
  'expenses',
  'budget',
  'card',
  'reimbursable',
  'history',
  'recurring',
  'cash',
  'banks',
  'diagram',
  'reminders',
);

describe('widgets do Início', () => {
  it('seguem a ordem do catálogo, com A receber logo depois de Lançamentos e o calendário depois dos Lembretes', () => {
    expect(homeCards({ modules: everything })).toEqual([
      'expenses',
      'reimbursable',
      'budget',
      'card',
      'history',
      'recurring',
      'cash',
      'banks',
      'diagram',
      'reminders',
      'calendar',
    ]);
  });

  it('não depende mais do rodapé que a pessoa tinha escolhido', () => {
    const settings: Pick<BudgetSettings, 'modules' | 'nav'> = {
      modules: on('expenses', 'reminders'),
      nav: ['reminders', 'inicio'],
    };
    expect(homeCards(settings)).toEqual(['expenses', 'reminders', 'calendar']);
  });

  it('não tem widget de módulo desligado nem de módulo sem widget, e numa conta sem nada salvo tem todos', () => {
    expect(homeCards({ modules: on('expenses', 'missions') })).toEqual(['expenses']);
    expect(homeCards({ modules: {} })).toEqual(homeCards({ modules: everything }));
  });

  it('o que a pessoa tirou espera na bandeja, e só enquanto o módulo está ligado', () => {
    const settings = {
      modules: on('expenses', 'reminders'),
      homeHidden: ['calendar', 'expenses'] as HomeWidgetKey[],
    };
    expect(hiddenHomeCards(settings)).toEqual(['expenses', 'calendar']);
    expect(hiddenHomeCards({ modules: on('expenses'), homeHidden: ['calendar'] })).toEqual([]);
  });
});

describe('Missões', () => {
  it('não é widget: fica numa faixa fixa no topo, e some de um Início que já a tinha', () => {
    expect(homeCards({ modules: everything })).not.toContain('missions');
    const homePages: HomeWidgetKey[][] = [['missions', 'budget'], ['expenses', 'card']];
    expect(resolveHomePages({ modules: on('missions', 'expenses', 'budget', 'card'), homePages })).toEqual([
      ['budget'],
      ['expenses', 'card'],
    ]);
  });
});

describe('áreas de trabalho', () => {
  const modules = on('expenses', 'budget', 'reminders', 'diagram');

  it('sem nada salvo, é uma área só, na ordem padrão e sem os que foram tirados', () => {
    expect(resolveHomePages({ modules })).toEqual([['expenses', 'budget', 'diagram', 'reminders', 'calendar']]);
    expect(resolveHomePages({ modules, homeHidden: ['budget'] })).toEqual([
      ['expenses', 'diagram', 'reminders', 'calendar'],
    ]);
    expect(resolveHomePages({ modules: on() })).toEqual([[]]);
  });

  it('a ordem salva antes das áreas vira a área 1', () => {
    expect(
      resolveHomePages({ modules, homeOrder: ['diagram', 'expenses', 'budget', 'reminders', 'calendar'] }),
    ).toEqual([['diagram', 'expenses', 'budget', 'reminders', 'calendar']]);
  });

  it('as áreas salvas valem mais que a ordem antiga', () => {
    expect(
      resolveHomePages({
        modules,
        homeOrder: ['budget', 'expenses'],
        homePages: [
          ['diagram', 'expenses'],
          ['budget', 'reminders', 'calendar'],
        ],
      }),
    ).toEqual([
      ['diagram', 'expenses'],
      ['budget', 'reminders', 'calendar'],
    ]);
  });

  it('o widget de um módulo que acabou de ser ligado vai para o fim da última área', () => {
    expect(
      resolveHomePages({
        modules,
        homePages: [
          ['diagram', 'expenses'],
          ['reminders', 'calendar'],
        ],
      }),
    ).toEqual([
      ['diagram', 'expenses'],
      ['reminders', 'calendar', 'budget'],
    ]);
  });

  it('um widget extra entra logo depois do card do seu módulo, na área em que ele estiver', () => {
    expect(
      resolveHomePages({
        modules,
        homePages: [
          ['reminders', 'diagram'],
          ['expenses', 'budget'],
        ],
      }),
    ).toEqual([
      ['reminders', 'calendar', 'diagram'],
      ['expenses', 'budget'],
    ]);
    // Com o card do módulo tirado da Início, o extra vai para o fim da última área.
    expect(
      resolveHomePages({
        modules,
        homeHidden: ['reminders'],
        homePages: [['diagram'], ['expenses', 'budget']],
      }),
    ).toEqual([['diagram'], ['expenses', 'budget', 'calendar']]);
  });

  it('cada widget fica numa área só', () => {
    expect(
      resolveHomePages({
        modules,
        homePages: [
          ['expenses', 'diagram', 'expenses'],
          ['diagram', 'budget', 'reminders', 'calendar'],
        ],
      }),
    ).toEqual([
      ['expenses', 'diagram'],
      ['budget', 'reminders', 'calendar'],
    ]);
  });

  it('tira áreas vazias e widgets que não estão mais disponíveis, mas deixa sempre uma área', () => {
    expect(
      resolveHomePages({
        modules: on('expenses'),
        homePages: [['cash', 'diagram'], [], ['expenses']],
      }),
    ).toEqual([['expenses']]);
    expect(
      resolveHomePages({
        modules,
        homeHidden: ['expenses', 'budget', 'reminders', 'calendar', 'diagram'],
        homePages: [['expenses'], ['diagram']],
      }),
    ).toEqual([[]]);
    expect(resolveHomePages({ modules: on(), homePages: [] })).toEqual([[]]);
  });

  it('o que foi tirado fica fora mesmo que ainda esteja salvo numa área', () => {
    expect(
      resolveHomePages({
        modules,
        homeHidden: ['diagram'],
        homePages: [['diagram', 'expenses', 'budget', 'reminders', 'calendar']],
      }),
    ).toEqual([['expenses', 'budget', 'reminders', 'calendar']]);
  });

  it(`nunca passa de ${MAX_HOME_PAGES} áreas`, () => {
    const many: HomeWidgetKey[][] = [
      ['expenses'],
      ['budget'],
      ['reminders'],
      ['calendar'],
      ['diagram'],
      ['card'],
    ];
    expect(resolveHomePages({ modules: everything, homePages: many })).toHaveLength(MAX_HOME_PAGES);
  });
});

describe('mexendo nas áreas', () => {
  const pages: HomeWidgetKey[][] = [
    ['expenses', 'budget', 'card'],
    ['reminders', 'calendar'],
  ];

  it('move dentro da mesma área como um arrayMove', () => {
    expect(moveWidget(pages, 'expenses', 0, 2)).toEqual([
      ['budget', 'card', 'expenses'],
      ['reminders', 'calendar'],
    ]);
    expect(moveWidget(pages, 'card', 0, 0)[0]).toEqual(['card', 'expenses', 'budget']);
  });

  it('move para outra área, na posição em que soltou', () => {
    expect(moveWidget(pages, 'budget', 1, 1)).toEqual([
      ['expenses', 'card'],
      ['reminders', 'budget', 'calendar'],
    ]);
    // Uma posição além do fim vira o fim.
    expect(moveWidget(pages, 'budget', 1, 99)[1]).toEqual(['reminders', 'calendar', 'budget']);
  });

  it('mover para uma área depois da última cria a área nova, até o limite', () => {
    expect(moveWidget(pages, 'card', 2, 0)).toEqual([
      ['expenses', 'budget'],
      ['reminders', 'calendar'],
      ['card'],
    ]);
    const full: HomeWidgetKey[][] = [['expenses'], ['budget'], ['card'], ['reminders'], ['calendar']];
    expect(moveWidget(full, 'expenses', 5, 0)).toBe(full);
  });

  it('adiciona no fim da área escolhida, tirando de onde estava', () => {
    expect(addWidget(pages, 'diagram', 0)).toEqual([
      ['expenses', 'budget', 'card', 'diagram'],
      ['reminders', 'calendar'],
    ]);
    expect(addWidget(pages, 'expenses', 1)).toEqual([
      ['budget', 'card'],
      ['reminders', 'calendar', 'expenses'],
    ]);
    expect(addWidget(pages, 'card', 0)[0]).toEqual(['expenses', 'budget', 'card']);
  });

  it('tira o widget e deixa a área vazia no lugar, para o modo de edição', () => {
    expect(removeWidget(pages, 'reminders')).toEqual([['expenses', 'budget', 'card'], ['calendar']]);
    const emptied = removeWidget(removeWidget(pages, 'reminders'), 'calendar');
    expect(emptied).toEqual([['expenses', 'budget', 'card'], []]);
    expect(withoutEmptyPages(emptied)).toEqual([['expenses', 'budget', 'card']]);
    expect(pageOfWidget(pages, 'calendar')).toBe(1);
    expect(pageOfWidget(pages, 'diagram')).toBe(-1);
  });

  it('cria área nova vazia no fim, até o limite', () => {
    expect(addHomePage(pages)).toEqual([...pages, []]);
    expect(addHomePage([[], [], [], [], []])).toBeNull();
  });

  it('excluir uma área leva os widgets dela para a área de antes, sem tirar nenhum da Início', () => {
    expect(deleteHomePage(pages, 1)).toEqual({
      pages: [['expenses', 'budget', 'card', 'reminders', 'calendar']],
      movedTo: 0,
    });
    // A primeira passa os widgets para a seguinte, que vira a primeira.
    expect(deleteHomePage(pages, 0)).toEqual({
      pages: [['reminders', 'calendar', 'expenses', 'budget', 'card']],
      movedTo: 0,
    });
    const three: HomeWidgetKey[][] = [['expenses'], [], ['diagram']];
    expect(deleteHomePage(three, 1)).toEqual({ pages: [['expenses'], ['diagram']], movedTo: -1 });
    expect(deleteHomePage(three, 2)).toEqual({ pages: [['expenses'], ['diagram']], movedTo: 1 });
  });

  it('a única área não se exclui', () => {
    expect(deleteHomePage([['diagram']], 0)).toEqual({ pages: [['diagram']], movedTo: -1 });
  });

  it('não mexe nas áreas recebidas', () => {
    const copy = JSON.stringify(pages);
    moveWidget(pages, 'budget', 1, 0);
    addWidget(pages, 'diagram', 1);
    removeWidget(pages, 'card');
    addHomePage(pages);
    deleteHomePage(pages, 0);
    expect(JSON.stringify(pages)).toBe(copy);
  });
});
