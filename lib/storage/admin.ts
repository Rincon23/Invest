import type { AdminOverview, SelfTestRun } from '../admin/types';
import type { ModuleKey } from '../budget/types';
import type { FactInput, InvestingFact } from '../motivation';
import { apiRequest, seg } from './apiClient';

/** Administração (owner only): the server's health, every account, every module's "Só VIP" and the "Você sabia?". */
export const adminRepository = {
  overview: () => apiRequest<AdminOverview>('GET', '/admin'),
  setVip: (userId: string, vip: boolean) =>
    apiRequest<{ vip: boolean }>('PUT', `/admin/users/${seg(userId)}/vip`, { vip }),
  /** `turnedOff`: the accounts without VIP that had the module on, now off. */
  setModuleVip: (key: ModuleKey, vipOnly: boolean) =>
    apiRequest<{ vipOnly: boolean; turnedOff: number }>('PUT', `/admin/modules/${seg(key)}/vip`, { vipOnly }),
  /** "Rodar agora": every automatic test, answering once they all ran. */
  runTests: () => apiRequest<SelfTestRun>('POST', '/admin/tests'),
  listFacts: () => apiRequest<{ facts: InvestingFact[] }>('GET', '/admin/facts'),
  createFact: (input: FactInput) => apiRequest<{ fact: InvestingFact }>('POST', '/admin/facts', input),
  updateFact: (id: string, input: FactInput) =>
    apiRequest<{ fact: InvestingFact }>('PUT', `/admin/facts/${seg(id)}`, input),
  deleteFact: (id: string) => apiRequest<{ deleted: boolean }>('DELETE', `/admin/facts/${seg(id)}`),
};
