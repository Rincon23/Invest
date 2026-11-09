import type { AssetAnswers, DiagramAsset, DiagramQuestion } from './types';

/** Where an asset's score comes from. */
export type ScoreSource =
  /** Its type's questions (Sim +1 / Não −1 / sem resposta 0, by weight). */
  | 'questions'
  /** A number typed directly: an ETF, or a type that still has no questions. */
  | 'direct';

export interface AssetScore {
  source: ScoreSource;
  /** −1..1; null when the asset was not evaluated yet (no direct score typed). */
  score: number | null;
  /** The weight of the questions answered Sim. */
  positive: number;
  /** The weight of the questions answered Não. */
  negative: number;
  /** Questions (with weight) still without an answer. */
  unanswered: number;
}

/** The questions that count: weight above 0. Weight 0 turns a question off without losing answers. */
export function activeQuestions(questions: DiagramQuestion[]): DiagramQuestion[] {
  return questions.filter((question) => question.weight > 0);
}

/**
 * `Σ(answer × weight) / Σ(weights)`, from −1 to 1. A question without an answer counts 0 and its
 * weight stays in the denominator (13 Sim out of 14 is 0,93, not 1).
 */
export function questionsScore(questions: DiagramQuestion[], answers: AssetAnswers): AssetScore {
  const counted = activeQuestions(questions);
  let positive = 0;
  let negative = 0;
  let unanswered = 0;
  let weights = 0;
  for (const question of counted) {
    weights += question.weight;
    const answer = answers[question.id];
    if (answer === 1) positive += question.weight;
    else if (answer === -1) negative += question.weight;
    else unanswered += 1;
  }
  return {
    source: 'questions',
    score: weights > 0 ? clampScore((positive - negative) / weights) : null,
    positive,
    negative,
    unanswered,
  };
}

/** Whether the asset is scored by a typed number instead of its type's questions. */
export function usesDirectScore(asset: Pick<DiagramAsset, 'isEtf'>, typeQuestions: DiagramQuestion[]): boolean {
  return asset.isEtf || activeQuestions(typeQuestions).length === 0;
}

/**
 * The asset's score, the same on every screen: an ETF (or any asset of a type that has no
 * questions yet) uses its direct score; everything else, its answers. "Não compro mais" does not
 * change the score shown — it only keeps the asset from receiving (see `buyWeight`).
 */
export function assetScore(
  asset: Pick<DiagramAsset, 'isEtf' | 'directScore'>,
  typeQuestions: DiagramQuestion[],
  answers: AssetAnswers = {},
): AssetScore {
  if (usesDirectScore(asset, typeQuestions)) {
    return {
      source: 'direct',
      score: asset.directScore === null ? null : clampScore(asset.directScore),
      positive: 0,
      negative: 0,
      unanswered: 0,
    };
  }
  return questionsScore(typeQuestions, answers);
}

/** What an asset weighs inside its type when an aporte is split: 0 when it should not receive. */
export function buyWeight(score: number | null, stopBuying: boolean): number {
  if (stopBuying || score === null) return 0;
  return Math.max(0, score);
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * How many points the screens show for a score: the score is kept from −1 to 1 (the formula of
 * the spreadsheet), and shown from −10 to 10 — the scale people already use for grades.
 */
export const SCORE_SCALE = 10;

/** "9,3", "−1,4", "10": the score on the −10…10 scale, one decimal at most, a real minus sign. */
export function formatScore(score: number | null): string {
  if (score === null) return '—';
  const text = Math.abs(score * SCORE_SCALE).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return score < 0 && text !== '0' ? `−${text}` : text;
}
