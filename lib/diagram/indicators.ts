import type { Answer, AutoQuestionKind, QuestionType } from './types';

/**
 * The questions the app can answer by itself, from free market data (VIP only): Graham for the
 * Brazilian stocks and P/VP for the real-estate funds. The rules are the owner's spreadsheet's.
 */

/** What the free source says about an asset (per share, in R$). Absent values are unknown. */
export interface AssetIndicators {
  /** Lucro por ação. */
  lpa: number | null;
  /** Valor patrimonial por ação (or per quota, for a fund). */
  vpa: number | null;
  /** Preço / valor patrimonial, as the source computes it. */
  pvp: number | null;
  /** When the source answered (ISO). */
  fetchedAt: string;
}

export interface AutoQuestionDefinition {
  kind: AutoQuestionKind;
  /** The only type it can be added to. */
  type: QuestionType;
  criterion: string;
  text: string;
  help: string;
}

export const AUTO_QUESTIONS: AutoQuestionDefinition[] = [
  {
    kind: 'graham',
    type: 'brStocks',
    criterion: 'Graham',
    text: 'O preço está perto ou abaixo do preço justo de Graham?',
    help: 'Preço justo = √(22,5 × LPA × VPA). Sim até 15% acima dele; Não de 15% a 100% acima com P/L abaixo de 15. Com P/L de 15 ou mais, ou o preço passando do dobro, Graham não se aplica e conta como Sim. Lucro ou patrimônio negativo: Não.',
  },
  {
    kind: 'pvp',
    type: 'fiis',
    criterion: 'P/VP',
    text: 'O P/VP está abaixo de 1?',
    help: 'Respondida sozinha com o P/VP de hoje: abaixo de 1 é Sim, 1 ou mais é Não.',
  },
];

export function autoQuestion(kind: AutoQuestionKind): AutoQuestionDefinition {
  const found = AUTO_QUESTIONS.find((question) => question.kind === kind);
  if (!found) throw new Error(`Pergunta automática desconhecida: ${kind}`);
  return found;
}

/** Graham's fair price, √(22,5 × LPA × VPA); null when the company has a loss or negative equity. */
export function grahamFairValue(lpa: number, vpa: number): number | null {
  if (!(lpa > 0) || !(vpa > 0)) return null;
  return Math.sqrt(22.5 * lpa * vpa);
}

export type GrahamVerdict =
  /** Up to 15% above the fair price (or below it). */
  | 'fair'
  /** 15% to 100% above it, with a P/L under 15. */
  | 'expensive'
  /** P/L of 15 or more, or more than twice the fair price: Graham does not fit a growth company. */
  | 'notApplicable'
  /** A loss or negative equity: no fair price. */
  | 'negative';

export interface GrahamResult {
  fairValue: number | null;
  /** price / fair price. */
  ratio: number | null;
  /** price / LPA. */
  pl: number | null;
  verdict: GrahamVerdict;
  answer: Answer;
}

/**
 * The owner's Graham rule: Sim up to 15% above the fair price; Não from 15% up to twice it when
 * the P/L is under 15; Sim again past that (or with a P/L of 15 or more), where Graham does not
 * apply. Null without data.
 */
export function grahamAnswer(price: number | null, lpa: number | null, vpa: number | null): GrahamResult | null {
  if (price === null || !(price > 0) || lpa === null || vpa === null) return null;
  const fairValue = grahamFairValue(lpa, vpa);
  if (fairValue === null) return { fairValue: null, ratio: null, pl: null, verdict: 'negative', answer: -1 };
  const ratio = price / fairValue;
  const pl = price / lpa;
  if (ratio >= 2 || pl >= 15) return { fairValue, ratio, pl, verdict: 'notApplicable', answer: 1 };
  if (ratio >= 1.15) return { fairValue, ratio, pl, verdict: 'expensive', answer: -1 };
  return { fairValue, ratio, pl, verdict: 'fair', answer: 1 };
}

/** P/VP under 1 is Sim, 1 or more is Não; null without data. */
export function pvpAnswer(pvp: number | null): Answer | null {
  if (pvp === null || !(pvp > 0)) return null;
  return pvp < 1 ? 1 : -1;
}

/** The answer of an automatic question for an asset, from its indicators and its price. */
export function autoAnswer(
  kind: AutoQuestionKind,
  indicators: AssetIndicators | undefined,
  price: number | null,
): Answer | null {
  if (!indicators) return null;
  if (kind === 'graham') return grahamAnswer(price, indicators.lpa, indicators.vpa)?.answer ?? null;
  return pvpAnswer(indicators.pvp);
}
