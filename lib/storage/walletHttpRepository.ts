import type {
  CardSettings,
  CashSettings,
  CreditCard,
  InstallmentPlan,
  InvestmentBucket,
  RecurringExpense,
  RecurringSettings,
} from '../budget/types';
import { apiRequest, seg } from './apiClient';
import type { ReservePlan } from '../budget/reserve';
import type {
  AdvanceInstallmentInput,
  AllocateInput,
  BillRef,
  ReserveContributionInput,
  WalletRepository,
  WalletSnapshot,
} from './wallet';

/** Browser-side WalletRepository: the Carteira screens against the app's own API. */
export class HttpWalletRepository implements WalletRepository {
  getSnapshot(): Promise<WalletSnapshot> {
    return apiRequest('GET', '/wallet');
  }

  saveRecurring(item: RecurringExpense): Promise<void> {
    return apiRequest('PUT', `/wallet/recurring/${seg(item.id)}`, item);
  }

  deleteRecurring(id: string): Promise<void> {
    return apiRequest('DELETE', `/wallet/recurring/${seg(id)}`);
  }

  saveInstallment(plan: InstallmentPlan): Promise<void> {
    return apiRequest('PUT', `/wallet/installments/${seg(plan.id)}`, plan);
  }

  deleteInstallment(id: string): Promise<void> {
    return apiRequest('DELETE', `/wallet/installments/${seg(id)}`);
  }

  advanceInstallment(id: string, input: AdvanceInstallmentInput): Promise<void> {
    return apiRequest('POST', `/wallet/installments/${seg(id)}/advance`, input);
  }

  saveCard(card: CreditCard): Promise<void> {
    return apiRequest('PUT', `/wallet/cards/${seg(card.id)}`, card);
  }

  deleteCard(id: string): Promise<void> {
    return apiRequest('DELETE', `/wallet/cards/${seg(id)}`);
  }

  payBill({ cardId, month }: BillRef): Promise<void> {
    return apiRequest('POST', `/wallet/cards/${seg(cardId)}/bills/${seg(month)}/pay`);
  }

  unpayBill({ cardId, month }: BillRef): Promise<void> {
    return apiRequest('DELETE', `/wallet/cards/${seg(cardId)}/bills/${seg(month)}/pay`);
  }

  saveCardSettings(settings: CardSettings): Promise<void> {
    return apiRequest('PUT', '/wallet/cards/settings', settings);
  }

  saveRecurringSettings(settings: RecurringSettings): Promise<void> {
    return apiRequest('PUT', '/wallet/recurring/settings', settings);
  }

  setTicker(ticker: string): Promise<void> {
    return apiRequest('PUT', '/wallet/investments', { ticker });
  }

  tradeQuotas(delta: number): Promise<void> {
    return apiRequest('POST', '/wallet/investments/quotas', { delta });
  }

  saveBucket(bucket: InvestmentBucket): Promise<void> {
    return apiRequest('PUT', `/wallet/investments/buckets/${seg(bucket.id)}`, bucket);
  }

  deleteBucket(id: string): Promise<void> {
    return apiRequest('DELETE', `/wallet/investments/buckets/${seg(id)}`);
  }

  allocate(input: AllocateInput): Promise<void> {
    return apiRequest('POST', '/wallet/investments/allocate', input);
  }

  refreshPrice(): Promise<void> {
    return apiRequest('POST', '/wallet/investments/price');
  }

  saveCashSettings(settings: CashSettings): Promise<void> {
    return apiRequest('PUT', '/wallet/cash', settings);
  }

  saveReservePlan(plan: ReservePlan): Promise<void> {
    return apiRequest('PUT', '/wallet/reserve/plan', plan);
  }

  deleteReservePlan(): Promise<void> {
    return apiRequest('DELETE', '/wallet/reserve/plan');
  }

  contributeToReserve(input: ReserveContributionInput): Promise<void> {
    return apiRequest('POST', '/wallet/reserve/contribute', input);
  }
}
