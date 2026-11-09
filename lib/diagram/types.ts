import type { AssetIndicators } from './indicators';

/**
 * The Diagrama: the person says how much they want to invest and the app says how much goes to
 * each type and each asset, from a target % per type and a score given to each asset.
 *
 * In the interface the parts of the portfolio are called "tipos" — never "categorias" (those are
 * the budget's) nor "baldes".
 */

/** The seven types an asset can be. Fixed: the type says where the price comes from. */
export type AssetType =
  | 'brStocks'
  | 'intlStocks'
  | 'fiis'
  | 'reits'
  | 'crypto'
  | 'fixedIncome'
  | 'intlFixedIncome';

/** Where a type's prices come from: B3 (Yahoo ".SA" as a fallback) or Yahoo in US$ (stocks and crypto). */
export type QuoteMarket = 'b3' | 'us' | 'crypto';

/**
 * The two fixed-income types: a total typed by hand for what has no quote (Tesouro Direto, CDB,
 * LCI, LCA…), plus any fund with a ticker (DEBB11, IMAB11, BND), priced like the other assets.
 */
export type FixedIncomeType = Extract<AssetType, 'fixedIncome' | 'intlFixedIncome'>;

/** The types that have questions; fixed-income assets are scored directly. */
export type QuestionType = Exclude<AssetType, FixedIncomeType>;

/**
 * The person's target per type, as a 0..1 ratio. A type that is a key here is in the person's
 * portfolio (even at 0%); a type that is absent was never added or was removed — it shows nowhere
 * and its assets wait, untouched, until the type is added again.
 */
export type DiagramTargets = Partial<Record<AssetType, number>>;

/** A Sim (+1) or Não (−1) answer. No answer is simply absent (it counts 0). */
export type Answer = 1 | -1;

export interface DiagramAsset {
  id: string;
  type: AssetType;
  /** As the person typed it, normalized: "PETR4", "VOO", "BTC". */
  ticker: string;
  quantity: number;
  /** When the quantity last changed (by hand or by an aporte). */
  quantityUpdatedOn: string | null;
  sector?: string;
  subsector?: string;
  note?: string;
  /** "Não compro mais": the score counts as 0 (never bought); the value still fills its type. */
  stopBuying: boolean;
  /** An ETF has no questions: its score is typed directly. */
  isEtf: boolean;
  /** −1..1, used by ETFs and while the type has no questions. */
  directScore: number | null;
  position: number;
}

/** The single total of a fixed-income type, in R$. */
/** What a fixed-income type holds without a quote (Tesouro Direto, CDB, LCI, LCA…), in R$. */
export interface FixedIncomeTotal {
  type: FixedIncomeType;
  amount: number;
  updatedOn: string | null;
  /** Its score (−1 to 1, 1 by default): how it shares the type with the funds that have a ticker. */
  score: number;
}

/** A question the app answers by itself from market data (VIP only). */
export type AutoQuestionKind = 'graham' | 'pvp';

export interface DiagramQuestion {
  id: string;
  type: QuestionType;
  /** Answered by the app (Graham, P/VP) for VIP accounts; for the others it does not count. */
  auto?: AutoQuestionKind;
  /** A word or two: "ROE", "P/VP". */
  criterion: string;
  text: string;
  help?: string;
  /** 0 turns the question off without deleting its answers. */
  weight: number;
  position: number;
}

/** Answers of one asset, by question id. */
export type AssetAnswers = Record<string, Answer>;

/** The current price of a ticker, already in R$. */
export interface AssetQuote {
  price: number;
  name?: string;
  /** When the source answered (ISO). */
  fetchedAt: string;
}

export interface DiagramSettings {
  targets: DiagramTargets;
  /** The amount of the last calculation, to fill the field next time. */
  lastAmount: number | null;
}

/** One registered aporte (the history). */
export interface DiagramContribution {
  id: string;
  date: string;
  amount: number;
  items: DiagramContributionItem[];
}

export interface DiagramContributionItem {
  type: AssetType;
  /** The asset; absent for a fixed-income total. */
  assetId?: string;
  ticker?: string;
  quantity: number;
  price: number | null;
  amount: number;
}

/** Everything the Diagrama screen reads, in one request. */
export interface DiagramOverview {
  /** The automatic questions (Graham, P/VP) work only for VIP accounts. */
  vip: boolean;
  /**
   * By asset id: LPA, VPA and P/VP from the free source, for the assets an automatic question
   * needs (VIP only). Their answers already come inside `answers`.
   */
  indicators: Record<string, AssetIndicators>;
  settings: DiagramSettings;
  assets: DiagramAsset[];
  fixedIncome: FixedIncomeTotal[];
  questions: DiagramQuestion[];
  /** By asset id. */
  answers: Record<string, AssetAnswers>;
  /** By asset id, in R$. Absent when no source ever priced it. */
  quotes: Record<string, AssetQuote>;
  /** R$ per US$, when known (what converted the international prices). */
  dollar: AssetQuote | null;
  contributions: DiagramContribution[];
}

/** The Diagrama inside the account's backup ("Exportar dados"). */
export interface DiagramBackup {
  settings: DiagramSettings;
  assets: DiagramAsset[];
  fixedIncome: FixedIncomeTotal[];
  questions: DiagramQuestion[];
  answers: Record<string, AssetAnswers>;
  contributions: DiagramContribution[];
}

/** What "Aportar" / "Aportar tudo" sends: quotas per asset, R$ per fixed-income type. */
export interface ContributeInput {
  date: string;
  /** The competence of the expense, when one is launched. */
  month: string;
  items: { assetId?: string; type: AssetType; quantity: number }[];
  /** Also launch the total as an expense in the budget's Investimentos category. */
  launchExpense: boolean;
}

/** What adding or editing an asset sends (the ticker is normalized on the server). */
export interface AssetInput {
  type: AssetType;
  ticker: string;
  quantity: number;
  sector?: string | null;
  subsector?: string | null;
  note?: string | null;
  stopBuying: boolean;
  isEtf: boolean;
  directScore: number | null;
}

export type QuestionInput = Pick<DiagramQuestion, 'type' | 'criterion' | 'text' | 'weight'> & {
  help?: string | null;
};
