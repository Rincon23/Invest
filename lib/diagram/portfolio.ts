import { assetFractionDigits, isFixedIncomeType, typesInUse } from './assetTypes';
import type { PlanPosition } from './plan';
import { assetScore, type AssetScore } from './score';
import type { AssetType, DiagramAsset, DiagramOverview, DiagramQuestion, FixedIncomeType } from './types';

type Source = Pick<
  DiagramOverview,
  'settings' | 'assets' | 'fixedIncome' | 'questions' | 'answers' | 'quotes' | 'vip'
>;

/** The questions of one type, in order. */
export function questionsOf(questions: DiagramQuestion[], type: AssetType): DiagramQuestion[] {
  return questions.filter((question) => question.type === type).sort((a, b) => a.position - b.position);
}

/** What an asset is worth now in R$ (0 while no source ever priced it). */
export function assetValue(asset: DiagramAsset, source: Pick<DiagramOverview, 'quotes'>): number {
  const quote = source.quotes[asset.id];
  return quote ? asset.quantity * quote.price : 0;
}

/**
 * The questions of a type that this account sees and that count: an automatic one (Graham, P/VP)
 * is restricted — an account without access never sees it, and it stays out of the score.
 */
export function countedQuestions(
  source: Pick<DiagramOverview, 'questions' | 'vip'>,
  type: AssetType,
): DiagramQuestion[] {
  return questionsOf(source.questions, type).filter((question) => !question.auto || source.vip);
}

export function scoreOf(
  asset: DiagramAsset,
  source: Pick<DiagramOverview, 'questions' | 'answers' | 'vip'>,
): AssetScore {
  return assetScore(asset, countedQuestions(source, asset.type), source.answers[asset.id]);
}

export function fixedIncomeAmount(source: Pick<DiagramOverview, 'fixedIncome'>, type: FixedIncomeType): number {
  return source.fixedIncome.find((total) => total.type === type)?.amount ?? 0;
}

/** How the fixed-income total is called: what the person holds that has no quote. */
export const UNQUOTED_LABEL = 'Títulos sem cotação';

/** Every position of the types in the portfolio, as the aporte calculation takes them. */
export function planPositions(source: Source): PlanPosition[] {
  const inUse = new Set(typesInUse(source.settings.targets));
  const positions: PlanPosition[] = [];
  for (const type of inUse) {
    if (!isFixedIncomeType(type)) continue;
    positions.push({
      id: type,
      type,
      label: UNQUOTED_LABEL,
      value: fixedIncomeAmount(source, type),
      price: null,
      fractionDigits: 2,
      unit: 'money',
      score: source.fixedIncome.find((total) => total.type === type)?.score ?? 1,
      stopBuying: false,
    });
  }
  for (const asset of [...source.assets].sort((a, b) => a.position - b.position)) {
    if (!inUse.has(asset.type)) continue;
    positions.push({
      id: asset.id,
      type: asset.type,
      label: asset.ticker,
      value: assetValue(asset, source),
      price: source.quotes[asset.id]?.price ?? null,
      fractionDigits: assetFractionDigits(asset.type, asset.ticker),
      unit: 'quota',
      score: scoreOf(asset, source).score,
      stopBuying: asset.stopBuying,
    });
  }
  return positions;
}

export interface TypeSlice {
  type: AssetType;
  value: number;
  /** Share of the portfolio now (0..1). */
  share: number;
  /** The person's target (0..1). */
  target: number;
}

/** The portfolio by type, for the charts: the types in use, their value now and their target. */
export function portfolioByType(source: Source): { total: number; slices: TypeSlice[] } {
  const positions = planPositions(source);
  const total = positions.reduce((sum, position) => sum + position.value, 0);
  const slices = typesInUse(source.settings.targets).map((type) => {
    const value = positions.filter((position) => position.type === type).reduce((sum, p) => sum + p.value, 0);
    return { type, value, share: total > 0 ? value / total : 0, target: source.settings.targets[type] ?? 0 };
  });
  return { total, slices };
}
