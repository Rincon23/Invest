import type { CategoryKind } from '../budget/types';

/** One category an expense can go to, as a text (a bank transaction's description) is read. */
export interface CategoryOption {
  categoryKind: CategoryKind;
  /** Set when categoryKind is 'topic'. */
  topicId?: string;
  /** The user's own name for it ("Prazeres e Confortos", "Custos Fixos", "A receber"). */
  label: string;
}
