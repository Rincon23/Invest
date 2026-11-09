import type { BankHoldings } from '../banks/holdings';
import type { BanksOverview } from '../banks/types';
import { apiRequest, seg } from './apiClient';

export interface BanksOverviewResult extends BanksOverview {
  /** Banks whose authorization was never finished and that were taken out on this read. */
  givenUp: number;
}

/** The Open Finance screen only talks to this contract. */
export interface BanksRepository {
  getOverview(): Promise<BanksOverviewResult>;
  saveKey(clientId: string, clientSecret: string): Promise<void>;
  /** Creates the connection and answers where the person authorizes it (the screen goes there). */
  connect(): Promise<{ authorizeUrl: string }>;
  /** Reads what Pluggy has right away; answers the banks that brought something new. */
  sync(): Promise<{ changed: string[] }>;
  rename(itemId: string, name: string): Promise<void>;
  remove(itemId: string): Promise<void>;
  /** The stocks and funds the banks hold, for the Diagrama to compare quantities. */
  getHoldings(): Promise<BankHoldings>;
  disconnect(): Promise<void>;
}

export class HttpBanksRepository implements BanksRepository {
  getOverview(): Promise<BanksOverviewResult> {
    return apiRequest('GET', '/banks');
  }

  saveKey(clientId: string, clientSecret: string): Promise<void> {
    return apiRequest('PUT', '/banks/key', { clientId, clientSecret });
  }

  connect(): Promise<{ authorizeUrl: string }> {
    return apiRequest('POST', '/banks/connections');
  }

  sync(): Promise<{ changed: string[] }> {
    return apiRequest('POST', '/banks/sync');
  }

  rename(itemId: string, name: string): Promise<void> {
    return apiRequest('PATCH', `/banks/connections/${seg(itemId)}`, { name });
  }

  remove(itemId: string): Promise<void> {
    return apiRequest('DELETE', `/banks/connections/${seg(itemId)}`);
  }

  getHoldings(): Promise<BankHoldings> {
    return apiRequest('GET', '/banks/holdings');
  }

  disconnect(): Promise<void> {
    return apiRequest('DELETE', '/banks');
  }
}
