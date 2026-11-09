import { describe, expect, it } from 'vitest';
import { categoryOptions, findCategory, type CategoryOption } from '../index';

const settings = {
  topics: [
    { id: 't-div', name: 'Diversos', targetPct: 0.2, order: 0 },
    { id: 't-inv', name: 'Investimentos', targetPct: 0.45, order: 1 },
    { id: 't-met', name: 'Metas', targetPct: 0.25, order: 2 },
    { id: 't-con', name: 'Conhecimentos', targetPct: 0.1, order: 3 },
    { id: 't-old', name: 'Viagem', targetPct: 0, order: 4, archived: true },
  ],
  specialCategories: { fixedCost: 'Custo Fixo', unforeseen: 'Imprevistos' },
  modules: { expenses: true, card: true, reimbursable: true },
};
const options = categoryOptions(settings);
const byKind = (kind: string, topicId?: string) =>
  options.find((o) => o.categoryKind === kind && o.topicId === topicId) as CategoryOption;

describe('categoryOptions', () => {
  it('lists the active categories, the special ones and "A receber" when it is on', () => {
    expect(options.map((o) => o.label)).toEqual([
      'Diversos',
      'Investimentos',
      'Metas',
      'Conhecimentos',
      'Custo Fixo',
      'Imprevistos',
      'A receber',
    ]);
    expect(categoryOptions({ ...settings, modules: { reimbursable: false } }).map((o) => o.label)).not.toContain('A receber');
  });
});

describe('findCategory', () => {
  it('ignores case, accents and singular/plural', () => {
    expect(findCategory('CUSTO FIXO', options).option).toEqual(byKind('fixedCost'));
    expect(findCategory('imprevisto', options).option).toEqual(byKind('unforeseen'));
    expect(findCategory('na meta', options).option).toEqual(byKind('topic', 't-met'));
    expect(findCategory('investimento', options).option).toEqual(byKind('topic', 't-inv'));
  });

  it('still recognizes the usual name of a renamed special category', () => {
    const renamed = categoryOptions({
      ...settings,
      specialCategories: { fixedCost: 'Contas da casa', unforeseen: 'Emergências' },
    });
    expect(findCategory('conta de luz, custos fixos', renamed).option?.categoryKind).toBe('fixedCost');
    expect(findCategory('remédio, emergência', renamed).option?.categoryKind).toBe('unforeseen');
  });

  it('prefers the name after "categoria" and a name over a synonym of "A receber"', () => {
    expect(findCategory('mercado para as metas da casa, categoria diversos', options).option).toEqual(
      byKind('topic', 't-div'),
    );
    expect(findCategory('ele vai me devolver, categoria metas', options).option).toEqual(
      byKind('topic', 't-met'),
    );
  });

  it('leaves it open when two categories are said the same way', () => {
    const reading = findCategory('diversos ou metas', options);
    expect(reading.option).toBeUndefined();
    expect(reading.mentioned).toHaveLength(2);
  });

  it('ignores "A receber" synonyms when the module is off', () => {
    const withoutReimbursable = categoryOptions({ ...settings, modules: { reimbursable: false } });
    expect(findCategory('ele vai me devolver', withoutReimbursable).option).toBeUndefined();
  });
});
