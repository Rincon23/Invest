import type { AdminOverview, SelfTestRun } from '../admin/types';
import type { ModuleKey } from '../core/types';
import { apiRequest, seg } from './apiClient';

/** Administração (owner only): the server's health, every account, and every module's "Restrito". */
export const adminRepository = {
  overview: () => apiRequest<AdminOverview>('GET', '/admin'),
  setVip: (userId: string, vip: boolean) =>
    apiRequest<{ vip: boolean }>('PUT', `/admin/users/${seg(userId)}/vip`, { vip }),
  /** `turnedOff`: the accounts without VIP that had the module on, now off. */
  setModuleVip: (key: ModuleKey, vipOnly: boolean) =>
    apiRequest<{ vipOnly: boolean; turnedOff: number }>('PUT', `/admin/modules/${seg(key)}/vip`, { vipOnly }),
  /** "Rodar agora": every automatic test, answering once they all ran. */
  runTests: () => apiRequest<SelfTestRun>('POST', '/admin/tests'),
};
