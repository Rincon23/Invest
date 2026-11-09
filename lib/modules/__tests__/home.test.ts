import { describe, expect, it } from 'vitest';
import type { HomeWidgetKey, ModuleKey } from '../../core/types';
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
const everything = on('diagram', 'history', 'banks');

describe('widgets do Início', () => {
  it('seguem a ordem do catálogo', () => {
    expect(homeCards({ modules: everything })).toEqual(['diagram', 'history', 'banks']);
  });

  it('não tem widget de módulo desligado, e numa conta sem nada salvo tem todos', () => {
    expect(homeCards({ modules: on('diagram', 'history') })).toEqual(['diagram', 'history']);
    expect(homeCards({ modules: {} })).toEqual(['diagram', 'history', 'banks']);
  });

  it('o que a pessoa tirou espera na bandeja, e só enquanto o módulo está ligado', () => {
    expect(hiddenHomeCards({ modules: everything, homeHidden: ['history'] })).toEqual(['history']);
    expect(hiddenHomeCards({ modules: on('diagram'), homeHidden: ['banks'] })).toEqual([]);
  });
});

describe('áreas de trabalho', () => {
  it('sem nada salvo, é uma área só, na ordem padrão e sem os que foram tirados', () => {
    expect(resolveHomePages({ modules: everything })).toEqual([['diagram', 'history', 'banks']]);
    expect(resolveHomePages({ modules: everything, homeHidden: ['history'] })).toEqual([['diagram', 'banks']]);
  });

  it('as áreas salvas valem, e o widget de um módulo que acabou de ser ligado vai para o fim da última', () => {
    const pages: HomeWidgetKey[][] = [['history'], ['diagram']];
    expect(resolveHomePages({ modules: everything, homePages: pages })).toEqual([['history'], ['diagram', 'banks']]);
  });

  it('cada widget fica numa área só, e áreas vazias saem (mas sempre fica uma)', () => {
    const pages: HomeWidgetKey[][] = [['diagram', 'history'], ['diagram'], []];
    expect(resolveHomePages({ modules: on('diagram', 'history'), homePages: pages })).toEqual([
      ['diagram', 'history'],
    ]);
    expect(resolveHomePages({ modules: on('diagram'), homeHidden: ['diagram'], homePages: [['diagram']] })).toEqual([[]]);
  });

  it(`nunca passa de ${MAX_HOME_PAGES} áreas`, () => {
    const many: HomeWidgetKey[][] = [['diagram'], [], [], [], [], ['history'], ['banks']];
    expect(resolveHomePages({ modules: everything, homePages: many }).length).toBeLessThanOrEqual(MAX_HOME_PAGES);
  });
});

describe('mexendo nas áreas', () => {
  // The helpers move any key around; five names make the limits easy to read.
  const pages = [
    ['expenses', 'budget', 'card'],
    ['reminders', 'calendar'],
  ] as unknown as HomeWidgetKey[][];

  it('move dentro da mesma área como um arrayMove', () => {
    expect(moveWidget(pages, 'expenses' as HomeWidgetKey, 0, 2)).toEqual([
      ['budget', 'card', 'expenses'],
      ['reminders', 'calendar'],
    ]);
    expect(moveWidget(pages, 'card' as HomeWidgetKey, 0, 0)[0]).toEqual(['card', 'expenses', 'budget']);
  });

  it('move para outra área, na posição em que soltou', () => {
    expect(moveWidget(pages, 'budget' as HomeWidgetKey, 1, 1)).toEqual([
      ['expenses', 'card'],
      ['reminders', 'budget', 'calendar'],
    ]);
    // Uma posição além do fim vira o fim.
    expect(moveWidget(pages, 'budget' as HomeWidgetKey, 1, 99)[1]).toEqual(['reminders', 'calendar', 'budget']);
  });

  it('mover para uma área depois da última cria a área nova, até o limite', () => {
    expect(moveWidget(pages, 'card' as HomeWidgetKey, 2, 0)).toEqual([
      ['expenses', 'budget'],
      ['reminders', 'calendar'],
      ['card'],
    ]);
    const full = [['expenses'], ['budget'], ['card'], ['reminders'], ['calendar']] as unknown as HomeWidgetKey[][];
    expect(moveWidget(full, 'expenses' as HomeWidgetKey, 5, 0)).toBe(full);
  });

  it('adiciona no fim da área escolhida, tirando de onde estava', () => {
    expect(addWidget(pages, 'diagram', 0)).toEqual([
      ['expenses', 'budget', 'card', 'diagram'],
      ['reminders', 'calendar'],
    ]);
    expect(addWidget(pages, 'expenses' as HomeWidgetKey, 1)).toEqual([
      ['budget', 'card'],
      ['reminders', 'calendar', 'expenses'],
    ]);
    expect(addWidget(pages, 'card' as HomeWidgetKey, 0)[0]).toEqual(['expenses', 'budget', 'card']);
  });

  it('tira o widget e deixa a área vazia no lugar, para o modo de edição', () => {
    expect(removeWidget(pages, 'reminders' as HomeWidgetKey)).toEqual([['expenses', 'budget', 'card'], ['calendar']]);
    const emptied = removeWidget(removeWidget(pages, 'reminders' as HomeWidgetKey), 'calendar' as HomeWidgetKey);
    expect(emptied).toEqual([['expenses', 'budget', 'card'], []]);
    expect(withoutEmptyPages(emptied)).toEqual([['expenses', 'budget', 'card']]);
    expect(pageOfWidget(pages, 'calendar' as HomeWidgetKey)).toBe(1);
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
    const three = [['expenses'], [], ['diagram']] as unknown as HomeWidgetKey[][];
    expect(deleteHomePage(three, 1)).toEqual({ pages: [['expenses'], ['diagram']], movedTo: -1 });
    expect(deleteHomePage(three, 2)).toEqual({ pages: [['expenses'], ['diagram']], movedTo: 1 });
  });

  it('a única área não se exclui', () => {
    expect(deleteHomePage([['diagram']], 0)).toEqual({ pages: [['diagram']], movedTo: -1 });
  });

  it('não mexe nas áreas recebidas', () => {
    const copy = JSON.stringify(pages);
    moveWidget(pages, 'budget' as HomeWidgetKey, 1, 0);
    addWidget(pages, 'diagram', 1);
    removeWidget(pages, 'card' as HomeWidgetKey);
    addHomePage(pages);
    deleteHomePage(pages, 0);
    expect(JSON.stringify(pages)).toBe(copy);
  });
});
