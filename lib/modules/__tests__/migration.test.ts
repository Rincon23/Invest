import { describe, expect, it } from 'vitest';
import type { HomeWidgetKey, ModuleKey, NavKey } from '../../budget/types';
import { migrateCardModule, migrateReserveModule } from '../migration';

/**
 * "Cartões" and "Parcelados" became part of "Cartão". Nobody who was already using them should
 * notice anything beyond the modules list getting shorter: the module stays on, and the entry
 * stays where it was in the bottom bar and in the Início order.
 */
describe('fusão dos módulos do cartão', () => {
  it('quem tinha Cartões ou Parcelados ligado passa a ter Cartão ligado', () => {
    const result = migrateCardModule({ modules: { expenses: true, cards: true } as never });
    expect(result.changed).toBe(true);
    expect(result.modules).toEqual({ expenses: true, card: true });
  });

  it('não liga Cartão para quem tinha as chaves gravadas como desligadas', () => {
    const result = migrateCardModule({
      modules: { expenses: true, cards: false, installments: false } as never,
    });
    expect(result.modules).toEqual({ expenses: true });
    expect(result.changed).toBe(true);
  });

  it('no rodapé e no Início, as duas chaves viram Cartão sem duplicar', () => {
    const result = migrateCardModule({
      modules: { card: true } as never,
      nav: ['inicio', 'cards', 'installments', 'expenses'] as NavKey[],
      homeOrder: ['cards', 'expenses', 'installments'] as ModuleKey[],
    });
    expect(result.nav).toEqual(['inicio', 'card', 'expenses']);
    expect(result.homeOrder).toEqual(['card', 'expenses']);
  });

  it('não mexe em quem já está migrado (roda de novo sem efeito)', () => {
    const settings = {
      modules: { expenses: true, card: true } as never,
      nav: ['inicio', 'card'] as NavKey[],
      homeOrder: null,
    };
    const first = migrateCardModule(settings);
    expect(first.changed).toBe(false);

    const second = migrateCardModule({
      modules: first.modules as never,
      nav: first.nav,
      homeOrder: first.homeOrder,
    });
    expect(second.changed).toBe(false);
    expect(second.modules).toEqual(first.modules);
  });
});

/**
 * "Reserva de emergência" and "Reserva investida" became one module, "Reserva". Whoever used the
 * invested reserve keeps it — now as the Investida tab — and its widget becomes the Reserva's.
 */
describe('fusão das duas reservas', () => {
  const widgets = (keys: string[]) => keys as HomeWidgetKey[];

  it('quem tinha a reserva investida ligada passa a ter a Reserva ligada', () => {
    const result = migrateReserveModule({ modules: { expenses: true, investments: true } as never });
    expect(result.changed).toBe(true);
    expect(result.modules).toEqual({ expenses: true, cash: true });
  });

  it('não liga a Reserva para quem tinha a investida desligada', () => {
    const result = migrateReserveModule({ modules: { investments: false, diagram: true } as never });
    expect(result.modules).toEqual({ diagram: true });
    expect(result.changed).toBe(true);
  });

  it('nas telas da Início, o widget da investida vira o da Reserva, sem duplicar', () => {
    const result = migrateReserveModule({
      modules: { expenses: true, investments: true, cash: true } as never,
      homePages: [widgets(['expenses', 'investments']), widgets(['cash', 'diagram'])],
      homeCardSizes: { investments: 'full', expenses: 'full' } as never,
    });
    expect(result.homePages).toEqual([['expenses', 'cash'], ['diagram']]);
    expect(result.homeCardSizes).toEqual({ expenses: 'full' });
  });

  it('a Reserva aparece se a investida aparecia, mesmo que a de emergência tivesse sido tirada', () => {
    const shown = migrateReserveModule({
      modules: { investments: true, cash: true } as never,
      homeHidden: widgets(['cash', 'calendar']),
    });
    expect(shown.homeHidden).toEqual(['calendar']);

    const bothHidden = migrateReserveModule({
      modules: { investments: true, cash: true } as never,
      homeHidden: widgets(['cash', 'investments']),
    });
    expect(bothHidden.homeHidden).toEqual(['cash']);
  });

  it('o rodapé antigo e a ordem antiga da Início também trocam a chave', () => {
    const result = migrateReserveModule({
      modules: {} as never,
      nav: ['inicio', 'investments', 'cash'] as NavKey[],
      homeOrder: widgets(['investments', 'expenses']),
    });
    expect(result.nav).toEqual(['inicio', 'cash']);
    expect(result.homeOrder).toEqual(['cash', 'expenses']);
  });

  it('não mexe em quem nunca teve a reserva investida (roda de novo sem efeito)', () => {
    const settings = {
      modules: { expenses: true, cash: true } as never,
      homePages: [widgets(['expenses', 'cash'])],
      homeHidden: widgets(['calendar']),
    };
    expect(migrateReserveModule(settings).changed).toBe(false);
    const migrated = migrateReserveModule({ modules: { investments: true } as never });
    expect(migrateReserveModule({ modules: migrated.modules as Partial<Record<ModuleKey, boolean>> }).changed).toBe(
      false,
    );
  });
});
