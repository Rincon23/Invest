import { DEFAULT_SPECIAL_CATEGORY_LABELS, resolveSpecialCategoryLabels } from '../budget/categories';
import { isModuleOn } from '../modules/flags';
import type { BudgetSettings } from '../budget/types';
import { foldText, phrasePattern } from './text';
import type { CategoryOption } from './types';

/**
 * The categories an expense can go to for this user, in the order the form shows them: the
 * active categories, the special ones and "A receber" when that module is on. A text is
 * read against these names, never a fixed list.
 */
export function categoryOptions(
  settings: Pick<BudgetSettings, 'topics' | 'specialCategories' | 'modules'>,
): CategoryOption[] {
  const labels = resolveSpecialCategoryLabels(settings.specialCategories);
  const options: CategoryOption[] = settings.topics
    .filter((topic) => !topic.archived)
    .sort((a, b) => a.order - b.order)
    .map((topic) => ({ categoryKind: 'topic', topicId: topic.id, label: topic.name }));
  options.push({ categoryKind: 'fixedCost', label: labels.fixedCost });
  options.push({ categoryKind: 'unforeseen', label: labels.unforeseen });
  if (isModuleOn(settings, 'reimbursable')) {
    options.push({ categoryKind: 'reimbursable', label: labels.reimbursable });
  }
  return options;
}

export function sameCategory(a: CategoryOption, b: CategoryOption): boolean {
  return a.categoryKind === b.categoryKind && (a.topicId ?? '') === (b.topicId ?? '');
}

/**
 * Ways of saying "someone will pay me back" (the bot's "Ressarcido"). They count less than
 * a category said by name, so "…vai me devolver, categoria metas" stays in Metas.
 */
const REIMBURSABLE_SYNONYMS = [
  'ressarcido',
  'ressarcimento',
  'reembolso',
  'reembolsado',
  'reembolsavel',
  'vai me devolver',
  'vao me devolver',
  'vai me reembolsar',
  'vai me pagar de volta',
  'vao me pagar de volta',
];

/** Said right before a category name: "categoria metas", "na categoria de investimentos". */
const CATEGORY_CUE = /categoria[\s:,.-]+(?:de\s+|da\s+|do\s+)?$/;

interface PhraseRule {
  option: CategoryOption;
  pattern: RegExp;
  /** 2 for the category's name, 1 for a synonym. */
  weight: number;
}

function phraseRules(options: CategoryOption[]): PhraseRule[] {
  const rules: PhraseRule[] = [];
  const add = (option: CategoryOption, phrase: string, weight: number) => {
    if (foldText(phrase).trim() === '') return;
    rules.push({ option, pattern: new RegExp(phrasePattern(phrase), 'g'), weight });
  };
  for (const option of options) {
    add(option, option.label, 2);
    // A renamed special category still answers to its usual name ("custos fixos").
    if (option.categoryKind !== 'topic') {
      const usual = DEFAULT_SPECIAL_CATEGORY_LABELS[option.categoryKind];
      if (foldText(usual) !== foldText(option.label)) add(option, usual, 2);
    }
    if (option.categoryKind === 'reimbursable') {
      for (const synonym of REIMBURSABLE_SYNONYMS) add(option, synonym, 1);
    }
  }
  return rules;
}

interface Found {
  option: CategoryOption;
  start: number;
  end: number;
  score: number;
}

export interface CategoryReading {
  /** The category, when exactly one stands out. */
  option?: CategoryOption;
  /** Every category that was mentioned (more than one means the text was ambiguous). */
  mentioned: CategoryOption[];
  /** Where the winning category was said, to keep its words out of the description. */
  spans: Array<[number, number]>;
}

/**
 * Finds the category the text names. Upper/lower case, accents and singular/plural don't
 * matter ("custos fixos" is "Custo Fixo"). A name right after the word "categoria" beats any
 * other mention, and a name beats a synonym of "A receber".
 */
export function findCategory(text: string, options: CategoryOption[]): CategoryReading {
  const folded = foldText(text);
  let found: Found[] = [];
  for (const rule of phraseRules(options)) {
    for (const match of folded.matchAll(rule.pattern)) {
      const start = match.index;
      const cue = CATEGORY_CUE.test(folded.slice(Math.max(0, start - 20), start));
      found.push({
        option: rule.option,
        start,
        end: start + match[0].length,
        score: rule.weight + (cue ? 2 : 0),
      });
    }
  }
  // "custo fixo" also contains "fixo": a mention inside a longer one doesn't count.
  found = found.filter(
    (inner) =>
      !found.some(
        (outer) =>
          outer !== inner &&
          outer.start <= inner.start &&
          outer.end >= inner.end &&
          outer.end - outer.start > inner.end - inner.start,
      ),
  );

  const mentioned: CategoryOption[] = [];
  for (const item of found) {
    if (!mentioned.some((option) => sameCategory(option, item.option))) mentioned.push(item.option);
  }
  if (found.length === 0) return { mentioned, spans: [] };

  const best = Math.max(...found.map((item) => item.score));
  const winners = found.filter((item) => item.score === best);
  const distinct = winners.filter(
    (item, index) => winners.findIndex((other) => sameCategory(other.option, item.option)) === index,
  );
  if (distinct.length !== 1) return { mentioned, spans: [] };

  const option = distinct[0].option;
  return {
    option,
    mentioned,
    spans: found.filter((item) => sameCategory(item.option, option)).map((item) => [item.start, item.end]),
  };
}

