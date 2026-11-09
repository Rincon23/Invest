// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_HOME_PAGES, MAX_WIDGETS_PER_HOME_PAGE } from '@/lib/modules';
import { settingsSchema } from '../validation';

describe('settingsSchema com as áreas da Início', () => {
  it('aceita as áreas, nulo (o padrão) ou nada', () => {
    const pages = [['diagram', 'history'], ['banks'], []];
    expect(settingsSchema.parse({ homePages: pages }).homePages).toEqual(pages);
    expect(settingsSchema.parse({ homePages: null }).homePages).toBeNull();
    expect(settingsSchema.parse({}).homePages).toBeUndefined();
  });

  it(`recusa mais de ${MAX_HOME_PAGES} áreas`, () => {
    const pages = Array.from({ length: MAX_HOME_PAGES + 1 }, () => ['diagram']);
    expect(settingsSchema.safeParse({ homePages: pages }).success).toBe(false);
    expect(settingsSchema.safeParse({ homePages: pages.slice(1) }).success).toBe(true);
  });

  it(`recusa mais de ${MAX_WIDGETS_PER_HOME_PAGE} widgets numa área`, () => {
    const page = Array.from({ length: MAX_WIDGETS_PER_HOME_PAGE + 1 }, () => 'diagram');
    expect(settingsSchema.safeParse({ homePages: [page] }).success).toBe(false);
  });

  it('deixa de fora o widget que não existe no Invest + (um do Capital +)', () => {
    const parsed = settingsSchema.parse({
      modules: { diagram: true, expenses: true },
      homePages: [['diagram', 'expenses'], ['relogio']],
      homeHidden: ['calendar', 'banks'],
      homeCardSizes: { calendar: 'half', history: 'full' },
    });
    expect(parsed.modules).toEqual({ diagram: true });
    expect(parsed.homePages).toEqual([['diagram'], []]);
    expect(parsed.homeHidden).toEqual(['banks']);
    expect(parsed.homeCardSizes).toEqual({ history: 'full' });
  });
});
