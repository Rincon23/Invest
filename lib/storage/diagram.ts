import type {
  Answer,
  AssetType,
  AssetInput,
  AutoQuestionKind,
  ContributeInput,
  DiagramAsset,
  DiagramContribution,
  DiagramOverview,
  DiagramQuestion,
  DiagramTargets,
  FixedIncomeType,
  HistoryRange,
  PriceHistory,
  QuestionInput,
  QuestionType,
} from '../diagram';
import { apiRequest, seg } from './apiClient';

/** A ticker suggestion while the person types. */
export interface TickerSuggestion {
  ticker: string;
  name?: string;
  isEtf: boolean;
}

/** An edited question; `auto: null` makes an automatic question a normal one again. */
export type QuestionUpdate = Omit<QuestionInput, 'type'> & { auto?: AutoQuestionKind | null };

/** Like `BudgetRepository`: the Diagrama screen only talks to this contract. */
export interface DiagramRepository {
  getOverview(): Promise<DiagramOverview>;
  saveTargets(targets: DiagramTargets): Promise<void>;
  saveLastAmount(amount: number): Promise<void>;
  setFixedIncome(type: FixedIncomeType, amount: number, date: string, score?: number): Promise<void>;
  addAsset(input: AssetInput, date: string): Promise<DiagramAsset>;
  updateAsset(id: string, input: AssetInput, date: string): Promise<void>;
  setStopBuying(id: string, stopBuying: boolean): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  setAnswer(assetId: string, questionId: string, answer: Answer | null): Promise<void>;
  addQuestion(input: QuestionInput): Promise<DiagramQuestion>;
  updateQuestion(id: string, input: QuestionUpdate): Promise<void>;
  enableAutoQuestion(kind: AutoQuestionKind): Promise<DiagramQuestion>;
  deleteQuestion(id: string): Promise<void>;
  reorderQuestions(type: QuestionType, ids: string[]): Promise<void>;
  useRecommended(type: QuestionType): Promise<{ added: number }>;
  refreshQuotes(): Promise<{ updated: number; missing: string[] }>;
  searchTickers(type: AssetType, query: string): Promise<TickerSuggestion[]>;
  contribute(input: ContributeInput): Promise<DiagramContribution>;
  /** Past prices of the assets (Histórico → Investimentos). */
  getHistory(range: HistoryRange): Promise<PriceHistory>;
}

export class HttpDiagramRepository implements DiagramRepository {
  getOverview(): Promise<DiagramOverview> {
    return apiRequest('GET', '/diagram');
  }

  saveTargets(targets: DiagramTargets): Promise<void> {
    return apiRequest('PUT', '/diagram/targets', { targets });
  }

  saveLastAmount(amount: number): Promise<void> {
    return apiRequest('PUT', '/diagram/last-amount', { amount });
  }

  setFixedIncome(type: FixedIncomeType, amount: number, date: string, score?: number): Promise<void> {
    return apiRequest('PUT', `/diagram/fixed-income/${seg(type)}`, { amount, date, score });
  }

  addAsset(input: AssetInput, date: string): Promise<DiagramAsset> {
    return apiRequest('POST', '/diagram/assets', { ...input, date });
  }

  updateAsset(id: string, input: AssetInput, date: string): Promise<void> {
    return apiRequest('PUT', `/diagram/assets/${seg(id)}`, { ...input, date });
  }

  setStopBuying(id: string, stopBuying: boolean): Promise<void> {
    return apiRequest('PUT', `/diagram/assets/${seg(id)}/stop-buying`, { stopBuying });
  }

  deleteAsset(id: string): Promise<void> {
    return apiRequest('DELETE', `/diagram/assets/${seg(id)}`);
  }

  setAnswer(assetId: string, questionId: string, answer: Answer | null): Promise<void> {
    return apiRequest('PUT', `/diagram/assets/${seg(assetId)}/answers`, { questionId, answer });
  }

  addQuestion(input: QuestionInput): Promise<DiagramQuestion> {
    return apiRequest('POST', '/diagram/questions', input);
  }

  updateQuestion(id: string, input: QuestionUpdate): Promise<void> {
    return apiRequest('PUT', `/diagram/questions/${seg(id)}`, input);
  }

  enableAutoQuestion(kind: AutoQuestionKind): Promise<DiagramQuestion> {
    return apiRequest('POST', '/diagram/questions/auto', { kind });
  }

  deleteQuestion(id: string): Promise<void> {
    return apiRequest('DELETE', `/diagram/questions/${seg(id)}`);
  }

  reorderQuestions(type: QuestionType, ids: string[]): Promise<void> {
    return apiRequest('PUT', '/diagram/questions/order', { type, ids });
  }

  useRecommended(type: QuestionType): Promise<{ added: number }> {
    return apiRequest('POST', '/diagram/questions/recommended', { type });
  }

  refreshQuotes(): Promise<{ updated: number; missing: string[] }> {
    return apiRequest('POST', '/diagram/quotes');
  }

  searchTickers(type: AssetType, query: string): Promise<TickerSuggestion[]> {
    const params = new URLSearchParams({ tipo: type, q: query });
    return apiRequest('GET', `/diagram/search?${params.toString()}`);
  }

  contribute(input: ContributeInput): Promise<DiagramContribution> {
    return apiRequest('POST', '/diagram/contributions', input);
  }

  getHistory(range: HistoryRange): Promise<PriceHistory> {
    return apiRequest('GET', `/diagram/history?periodo=${seg(range)}`);
  }
}
