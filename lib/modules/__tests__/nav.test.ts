import { describe, expect, it } from 'vitest';
import type { ModuleKey } from '../../budget/types';
import { MODULE_KEYS } from '../catalog';
import { HOME_NAV, homeHref, moreItems, navEntry } from '../nav';

/** Only these modules (the rest saved off, as for a restricted module). */
const on = (...keys: ModuleKey[]) => Object.fromEntries(MODULE_KEYS.map((key) => [key, keys.includes(key)]));
const everything = on(
  'expenses',
  'budget',
  'card',
  'reimbursable',
  'history',
  'recurring',
  'cash',
  'reminders',
);

describe('bandeja de apps', () => {
  it('lista todo módulo ligado com tela, agrupado', () => {
    expect(moreItems({ modules: everything })).toEqual([
      { group: 'month', label: 'Dinheiro do mês', keys: ['expenses', 'budget', 'card', 'history'] },
      {
        group: 'wallet',
        label: 'Carteira',
        keys: ['recurring', 'cash'],
      },
      { group: 'assistant', label: 'Assistente', keys: ['reminders'] },
    ]);
  });

  it('não lista módulo desligado nem módulo sem tela', () => {
    expect(moreItems({ modules: on('expenses', 'reimbursable') })).toEqual([
      { group: 'month', label: 'Dinheiro do mês', keys: ['expenses'] },
    ]);
    // Nothing saved: every module, the restricted ones included until access rules apply.
    expect(moreItems({ modules: {} }).flatMap((group) => group.keys)).toContain('banks');
  });
});

describe('telas', () => {
  it('"/" e a seta de voltar levam à Início do mês', () => {
    expect(homeHref('2026-09')).toBe('/mes/2026-09');
  });

  it('reconhece a Início só na tela do mês, não nas telas dentro dele', () => {
    expect(HOME_NAV.isActive('/mes/2026-09')).toBe(true);
    expect(HOME_NAV.isActive('/mes/2026-09/')).toBe(true);
    expect(HOME_NAV.isActive('/mes/2026-09/lancamentos')).toBe(false);
    expect(HOME_NAV.isActive('/cartao')).toBe(false);
  });

  it('leva ao mês que está na tela', () => {
    expect(navEntry('inicio').href('2026-09')).toBe('/mes/2026-09');
    expect(navEntry('expenses').href('2026-09')).toBe('/mes/2026-09/lancamentos');
    expect(navEntry('budget').href('2026-09')).toBe('/mes/2026-09/categorias');
  });
});
