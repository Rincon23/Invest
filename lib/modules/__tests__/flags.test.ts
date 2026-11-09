import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../core/settings';
import type { ModuleKey } from '../../core/types';
import { MODULES, MODULE_KEYS, moduleNames } from '../catalog';
import {
  ALL_MODULES,
  DEFAULT_VIP_MODULES,
  dependentsOf,
  effectiveModules,
  isModuleHidden,
  isModuleOn,
  mayUseModule,
  parentOf,
  resolveModules,
  storedModules,
  vipLockOf,
  vipModulesFrom,
  withAccessRules,
} from '../flags';

const off = (...keys: ModuleKey[]) => Object.fromEntries(keys.map((key) => [key, false]));
const notVipDefault = { vip: false, vipModules: DEFAULT_VIP_MODULES };

describe('catálogo de módulos', () => {
  it('tem os 3 módulos, cada um depois dos que ele precisa', () => {
    expect(MODULE_KEYS).toEqual(['diagram', 'history', 'banks']);
    MODULES.forEach((definition, index) => {
      for (const dep of definition.dependsOn) expect(MODULE_KEYS.indexOf(dep)).toBeLessThan(index);
    });
  });

  it('junta nomes de módulos em português', () => {
    expect(moduleNames(['diagram'])).toBe('Diagrama');
    expect(moduleNames(['diagram', 'history'])).toBe('Diagrama e Histórico');
    expect(moduleNames(['diagram', 'history', 'banks'])).toBe('Diagrama, Histórico e Open Finance');
  });

  it('não tem nada do Capital +: missões, gastos, cartão, reserva', () => {
    const text = JSON.stringify(MODULES).toLowerCase();
    for (const word of ['missões', 'lançamentos', 'cartão', 'reserva', 'lembretes']) expect(text).not.toContain(word);
  });
});

describe('módulos ligados', () => {
  it('liga tudo para uma conta nova: ninguém escolhe módulos', () => {
    expect(resolveModules(undefined)).toEqual(ALL_MODULES);
    expect(resolveModules(createDefaultSettings())).toEqual(ALL_MODULES);
    expect(isModuleOn(null, 'history')).toBe(true);
  });

  it('só fica desligado o que foi gravado como desligado (um módulo restrito)', () => {
    const settings = { modules: off('banks') };
    expect(isModuleOn(settings, 'banks')).toBe(false);
    expect(isModuleOn(settings, 'history')).toBe(true);
  });

  it('sem o Diagrama, nada que dependa dele funciona', () => {
    const settings = { modules: off('diagram') };
    expect(storedModules(settings).history).toBe(true);
    expect(isModuleOn(settings, 'history')).toBe(false);
    expect(isModuleOn(settings, 'banks')).toBe(false);
  });

  it('ignora uma chave que não existe aqui (um módulo do Capital +)', () => {
    const settings = { modules: { diagram: true, expenses: false } as Record<string, boolean> };
    expect(storedModules(settings).diagram).toBe(true);
    expect(Object.keys(storedModules(settings))).not.toContain('expenses');
  });
});

describe('dependências', () => {
  it('lista quem depende de um módulo', () => {
    expect(dependentsOf('diagram')).toEqual(['history', 'banks']);
    expect(dependentsOf('banks')).toEqual([]);
  });

  it('sabe de quem cada módulo depende mais de perto', () => {
    expect(parentOf('history')).toBe('diagram');
    expect(parentOf('diagram')).toBeNull();
  });
});

describe('módulos restritos', () => {
  const notVip = (...vipModules: ModuleKey[]) => ({ vip: false, vipModules });

  it('começa com o Open Finance restrito', () => {
    expect(DEFAULT_VIP_MODULES).toEqual(['banks']);
    expect(vipModulesFrom({})).toEqual(['banks']);
  });

  it('segue a escolha do dono em Administração, módulo por módulo', () => {
    expect(vipModulesFrom({ banks: false })).toEqual([]);
    expect(vipModulesFrom({ history: true })).toEqual(['history', 'banks']);
  });

  it('libera tudo para quem tem acesso e só o que não é restrito para os outros', () => {
    expect(mayUseModule({ vip: true, vipModules: ['banks'] }, 'banks')).toBe(true);
    expect(mayUseModule(notVip('banks'), 'banks')).toBe(false);
    expect(mayUseModule(notVip('banks'), 'history')).toBe(true);
  });

  it('tranca e esconde também o que depende de um módulo restrito', () => {
    expect(vipLockOf(notVip('diagram'), 'history')).toBe('diagram');
    expect(vipLockOf({ vip: true, vipModules: ['diagram'] }, 'history')).toBeNull();
    expect(isModuleHidden(notVip('diagram'), 'banks')).toBe(true);
    expect(isModuleHidden(notVip('banks'), 'history')).toBe(false);
  });
});

describe('withAccessRules', () => {
  it('liga tudo, menos o restrito para quem não tem acesso, seja lá o que foi gravado', () => {
    const ruled = withAccessRules({ modules: off('history') }, notVipDefault);
    expect(ruled.modules).toEqual({ ...ALL_MODULES, banks: false });
  });

  it('esconde também o que depende de um módulo restrito', () => {
    expect(effectiveModules({ vip: false, vipModules: ['diagram'] })).toEqual({
      diagram: false,
      history: false,
      banks: false,
    });
  });

  it('com acesso, tudo fica ligado, inclusive o restrito', () => {
    expect(withAccessRules({ modules: off('banks') }, { vip: true, vipModules: DEFAULT_VIP_MODULES }).modules).toEqual(
      ALL_MODULES,
    );
  });
});
