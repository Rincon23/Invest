/**
 * Open Finance through Meu Pluggy: what the screens see. Each bank the person brings is one
 * Pluggy "item" (one authorization at meu.pluggy.ai); its investments come with it.
 */

/**
 * - `pending`: created, waiting for the authorization or for the first data (about 2 minutes);
 * - `ok`: the data arrived;
 * - `error`: Pluggy's last update of this bank failed (it tries again by itself);
 * - `reconnect`: the authorization is gone; the person brings the bank again.
 */
export type BankConnectionStatus = 'pending' | 'ok' | 'error' | 'reconnect';

export type BankAccountKind = 'checking' | 'savings' | 'card' | 'other';

export interface BankConnection {
  itemId: string;
  /** The person's own name for it, or the one the app suggested. */
  name: string;
  /** Whether the person named it (then a new suggestion never replaces it). */
  named: boolean;
  status: BankConnectionStatus;
  /** When the bank last sent data to Meu Pluggy. */
  lastUpdatedAt: string | null;
  nextAutoSyncAt: string | null;
  /** When the authorization runs out (a year after it was given). */
  consentExpiresAt: string | null;
  createdAt: string;
  /** How many investments it sent in the last read. */
  investments: number;
}

export interface BanksOverview {
  /** The person's Pluggy key: the Client ID and only the end of the Secret. */
  key: { clientId: string; secretHint: string } | null;
  connections: BankConnection[];
  /** How many banks Meu Pluggy connects for free. */
  limit: number;
}

/** Meu Pluggy's free plan: up to 5 active connections, all of the same person. */
export const MEU_PLUGGY_LIMIT = 5;

export const MEU_PLUGGY_URL = 'https://meu.pluggy.ai';
export const PLUGGY_DASHBOARD_URL = 'https://dashboard.pluggy.ai';
