import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../budget/seed';
import type { ModuleKey } from '../../budget/types';
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
  it('tem os 11 módulos, Missões primeiro e cada um depois dos que ele precisa', () => {
    expect(MODULE_KEYS).toEqual([
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
    ]);
    MODULES.forEach((definition, index) => {
      for (const dep of definition.dependsOn) expect(MODULE_KEYS.indexOf(dep)).toBeLessThan(index);
    });
  });

  it('junta nomes de módulos em português', () => {
    expect(moduleNames(['expenses'])).toBe('Lançamentos');
    expect(moduleNames(['expenses', 'card'])).toBe('Lançamentos e Cartão');
    expect(moduleNames(['expenses', 'card', 'reimbursable'])).toBe(
      'Lançamentos, Cartão e A receber',
    );
  });

  it('nunca chama nada de "Ressarcido" nem de "balde"', () => {
    const text = JSON.stringify(MODULES).toLowerCase();
    expect(text).not.toContain('ressarcido');
    expect(text).not.toContain('balde');
  });
});

describe('módulos ligados', () => {
  it('liga tudo para uma conta nova: ninguém escolhe módulos', () => {
    expect(resolveModules(undefined)).toEqual(ALL_MODULES);
    expect(resolveModules(createDefaultSettings())).toEqual(ALL_MODULES);
    expect(isModuleOn(null, 'card')).toBe(true);
  });

  it('só fica desligado o que foi gravado como desligado (um módulo restrito)', () => {
    const settings = { modules: off('banks') };
    expect(isModuleOn(settings, 'banks')).toBe(false);
    expect(isModuleOn(settings, 'card')).toBe(true);
  });

  it('não conta como ligado um módulo cujo pai está desligado', () => {
    const settings = { modules: off('expenses') };
    expect(storedModules(settings).history).toBe(true);
    // Sem Lançamentos, nada que dependa dele funciona.
    expect(isModuleOn(settings, 'budget')).toBe(false);
    expect(isModuleOn(settings, 'history')).toBe(false);
    expect(isModuleOn(settings, 'card')).toBe(false);
    expect(isModuleOn(settings, 'cash')).toBe(true);
  });

  it('ignora uma chave que não existe mais (um módulo que foi fundido em outro)', () => {
    const settings = { modules: { expenses: true, cards: false } as Record<string, boolean> };
    expect(storedModules(settings).expenses).toBe(true);
    expect(Object.keys(storedModules(settings))).not.toContain('cards');
  });
});

describe('dependências', () => {
  it('lista quem depende de um módulo, direta ou indiretamente', () => {
    expect(dependentsOf('expenses')).toEqual([
      'budget',
      'card',
      'reimbursable',
      'history',
      'recurring',
    ]);
    expect(dependentsOf('card')).toEqual([]);
    expect(dependentsOf('budget')).toEqual(['history']);
    expect(dependentsOf('reminders')).toEqual([]);
  });

  it('sabe de quem cada módulo depende mais de perto', () => {
    expect(parentOf('reimbursable')).toBe('expenses');
    expect(parentOf('history')).toBe('budget');
    expect(parentOf('cash')).toBeNull();
  });
});

describe('módulos só para VIP', () => {
  const notVip = (...vipModules: ModuleKey[]) => ({ vip: false, vipModules });

  it('começa com Open Finance só para VIP', () => {
    expect(DEFAULT_VIP_MODULES).toEqual(['banks']);
    expect(vipModulesFrom({})).toEqual(['banks']);
  });

  it('segue a escolha do dono em Administração, módulo por módulo', () => {
    expect(vipModulesFrom({ banks: false })).toEqual([]);
    expect(vipModulesFrom({ diagram: true })).toEqual(['banks', 'diagram']);
    expect(vipModulesFrom({ banks: false, diagram: true })).toEqual(['diagram']);
  });

  it('libera tudo para VIP e só o que não é "Só VIP" para os outros', () => {
    expect(mayUseModule({ vip: true, vipModules: ['banks'] }, 'banks')).toBe(true);
    expect(mayUseModule(notVip('banks'), 'banks')).toBe(false);
    expect(mayUseModule(notVip('banks'), 'reminders')).toBe(true);
    expect(mayUseModule(notVip(), 'banks')).toBe(true);
  });

  it('tranca também o que depende de um módulo só VIP', () => {
    expect(vipLockOf(notVip('expenses'), 'expenses')).toBe('expenses');
    expect(vipLockOf(notVip('expenses'), 'history')).toBe('expenses');
    expect(vipLockOf(notVip('expenses'), 'cash')).toBeNull();
    expect(vipLockOf({ vip: true, vipModules: ['expenses'] }, 'history')).toBeNull();
  });

  it('esconde o módulo restrito e o que depende dele de quem não tem acesso', () => {
    expect(isModuleHidden(notVip('expenses'), 'expenses')).toBe(true);
    expect(isModuleHidden(notVip('expenses'), 'history')).toBe(true);
    expect(isModuleHidden(notVip('expenses'), 'cash')).toBe(false);
    expect(isModuleHidden({ vip: true, vipModules: ['expenses'] }, 'history')).toBe(false);
  });
});

describe('withAccessRules', () => {
  it('liga tudo, menos o restrito para quem não tem acesso, seja lá o que foi gravado', () => {
    const saved = { modules: off('card', 'reminders') };
    const ruled = withAccessRules(saved, notVipDefault);
    expect(ruled.modules).toEqual({ ...ALL_MODULES, banks: false });
    expect(isModuleOn(ruled, 'card')).toBe(true);
    expect(isModuleOn(ruled, 'banks')).toBe(false);
  });

  it('esconde também o que depende de um módulo restrito', () => {
    expect(effectiveModules({ vip: false, vipModules: ['budget'] })).toEqual({
      ...ALL_MODULES,
      budget: false,
      history: false,
    });
  });

  it('com acesso, tudo fica ligado, inclusive o restrito', () => {
    expect(withAccessRules({ modules: off('banks') }, { vip: true, vipModules: DEFAULT_VIP_MODULES }).modules).toEqual(
      ALL_MODULES,
    );
  });

  it('dá os módulos mesmo a um envio que não tinha nenhum', () => {
    expect(withAccessRules({ modules: undefined }, notVipDefault).modules).toEqual({
      ...ALL_MODULES,
      banks: false,
    });
  });
});
