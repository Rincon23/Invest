/**
 * Open Finance through Meu Pluggy: what the screens see. Each bank the person brings is one
 * Pluggy "item" (one authorization at meu.pluggy.ai); its accounts and cards come with it.
 */

/**
 * - `pending`: created, waiting for the authorization or for the first data (about 2 minutes);
 * - `ok`: the data arrived;
 * - `error`: Pluggy's last update of this bank failed (it tries again by itself);
 * - `reconnect`: the authorization is gone; the person brings the bank again.
 */
export type BankConnectionStatus = 'pending' | 'ok' | 'error' | 'reconnect';

export type BankAccountKind = 'checking' | 'savings' | 'card' | 'other';

/**
 * An account or card as the screens see it: no balance, limit or due date. The banks only check
 * what was entered in the Capital; the balances stay on the server for the Reserva (`reserve()`),
 * the only place they are shown, and only for the accounts the person marks.
 */
export interface BankAccount {
  id: string;
  kind: BankAccountKind;
  name: string;
}

export interface BankConnection {
  itemId: string;
  /** The person's own name for it, or the one the Capital suggested. */
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
  accounts: BankAccount[];
}

export interface BanksOverview {
  /** The person's Pluggy key: the Client ID and only the end of the Secret. */
  key: { clientId: string; secretHint: string } | null;
  connections: BankConnection[];
  /** How many banks Meu Pluggy connects for free. */
  limit: number;
}

/** An account or investment the person can mark as part of their reserve. */
export interface ReserveSource {
  id: string;
  kind: 'account' | 'investment';
  name: string;
  /** "conta", "poupança", "CDB", "Tesouro", "ação"… */
  detail: string;
  /** Fixed income and accounts first: what a reserve usually is. */
  usual: boolean;
  balance: number | null;
  marked: boolean;
}

export interface ReserveSourceBank {
  itemId: string;
  name: string;
  status: BankConnectionStatus;
  lastUpdatedAt: string | null;
  sources: ReserveSource[];
}

/** The Reserva fed by the banks: what can be marked, and the sum of what is. */
export interface BankReserve {
  banks: ReserveSourceBank[];
  /** The sum of the marked balances; null when nothing is marked (the person types it). */
  total: number | null;
}

/** Meu Pluggy's free plan: up to 5 active connections, all of the same person. */
export const MEU_PLUGGY_LIMIT = 5;

export const MEU_PLUGGY_URL = 'https://meu.pluggy.ai';
export const PLUGGY_DASHBOARD_URL = 'https://dashboard.pluggy.ai';
