// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/lib/budget';
import { MAX_HOME_PAGES, MAX_WIDGETS_PER_HOME_PAGE } from '@/lib/modules';
import { settingsSchema } from '../validation';

const base = () => {
  const { topics, specialCategories } = createDefaultSettings();
  return { topics, specialCategories };
};

describe('settingsSchema com as áreas da Início', () => {
  it('aceita as áreas, nulo (o padrão) ou nada', () => {
    const pages = [['expenses', 'budget'], ['reminders', 'calendar'], []];
    expect(settingsSchema.parse({ ...base(), homePages: pages }).homePages).toEqual(pages);
    expect(settingsSchema.parse({ ...base(), homePages: null }).homePages).toBeNull();
    expect(settingsSchema.parse(base()).homePages).toBeUndefined();
  });

  it(`recusa mais de ${MAX_HOME_PAGES} áreas`, () => {
    const pages = Array.from({ length: MAX_HOME_PAGES + 1 }, () => ['expenses']);
    expect(settingsSchema.safeParse({ ...base(), homePages: pages }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base(), homePages: pages.slice(1) }).success).toBe(true);
  });

  it(`recusa mais de ${MAX_WIDGETS_PER_HOME_PAGE} widgets numa área`, () => {
    const page = Array.from({ length: MAX_WIDGETS_PER_HOME_PAGE + 1 }, () => 'expenses');
    expect(settingsSchema.safeParse({ ...base(), homePages: [page] }).success).toBe(false);
  });

  it('recusa um widget que não existe', () => {
    expect(settingsSchema.safeParse({ ...base(), homePages: [['expenses', 'relogio']] }).success).toBe(false);
  });

  it('deixa de fora o Monitor de Gmail, que saiu do app, onde uma conta antiga o guardou', () => {
    const parsed = settingsSchema.parse({
      ...base(),
      modules: { expenses: true, gmail: true },
      nav: ['inicio', 'gmail'],
      homeOrder: ['gmail', 'expenses'],
      homePages: [['expenses', 'gmail'], ['gmail']],
      homeHidden: ['gmail', 'budget'],
      homeCardSizes: { gmail: 'half', recurring: 'full' },
    });
    expect(parsed.modules).toEqual({ expenses: true });
    expect(parsed.nav).toEqual(['inicio']);
    expect(parsed.homeOrder).toEqual(['expenses']);
    expect(parsed.homePages).toEqual([['expenses'], []]);
    expect(parsed.homeHidden).toEqual(['budget']);
    expect(parsed.homeCardSizes).toEqual({ recurring: 'full' });
  });

  it('continua aceitando o rodapé e a ordem antiga, de backups e apps em cache', () => {
    const parsed = settingsSchema.parse({ ...base(), nav: ['inicio', 'expenses'], homeOrder: ['expenses'] });
    expect(parsed.nav).toEqual(['inicio', 'expenses']);
    expect(parsed.homeOrder).toEqual(['expenses']);
  });
});
