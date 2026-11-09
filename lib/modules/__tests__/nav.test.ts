import { describe, expect, it } from 'vitest';
import type { ModuleKey } from '../../core/types';
import { MODULE_KEYS } from '../catalog';
import { HOME_NAV, homeHref, moreItems, navEntry } from '../nav';

/** Only these modules (the rest saved off, as for a restricted module). */
const on = (...keys: ModuleKey[]) => Object.fromEntries(MODULE_KEYS.map((key) => [key, keys.includes(key)]));

describe('bandeja de apps', () => {
  it('lista todo módulo ligado com tela, agrupado', () => {
    expect(moreItems({ modules: on('diagram', 'history', 'banks') })).toEqual([
      { group: 'investing', label: 'Investimentos', keys: ['diagram', 'history'] },
      { group: 'banks', label: 'Bancos', keys: ['banks'] },
    ]);
  });

  it('não lista módulo desligado (um restrito, numa conta sem acesso)', () => {
    expect(moreItems({ modules: on('diagram', 'history') })).toEqual([
      { group: 'investing', label: 'Investimentos', keys: ['diagram', 'history'] },
    ]);
    // Nothing saved: every module, the restricted ones included until access rules apply.
    expect(moreItems({ modules: {} }).flatMap((group) => group.keys)).toContain('banks');
  });

  it('sem o Diagrama, nada do que depende dele aparece', () => {
    expect(moreItems({ modules: on('history', 'banks') })).toEqual([]);
  });
});

describe('telas', () => {
  it('a seta de voltar leva à Início, em "/"', () => {
    expect(homeHref()).toBe('/');
    expect(HOME_NAV.isActive('/')).toBe(true);
    expect(HOME_NAV.isActive('/diagrama')).toBe(false);
  });

  it('cada módulo abre a sua tela', () => {
    expect(navEntry('inicio').href()).toBe('/');
    expect(navEntry('diagram').href()).toBe('/diagrama');
    expect(navEntry('history').href()).toBe('/historico');
    expect(navEntry('banks').href()).toBe('/bancos');
  });
});
