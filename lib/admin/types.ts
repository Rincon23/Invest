/** What the Administração screen shows. Only the server's owner (OWNER_EMAIL) ever gets it. */

import type { ModuleKey } from '../budget/types';

export interface LoadGuardConfig {
  /** Average requests per second that raise a warning. */
  alertRps: number;
  /** Average requests per second that pause the server. */
  shedRps: number;
  /** How long a pause lasts, extended while the flood goes on. */
  shedSeconds: number;
  /** Requests one IP may make in a minute. */
  ipPerMinute: number;
  /** Requests one IP may make in 10 seconds: keeps a single address from ever pausing the server. */
  ipPer10s: number;
  /** Board temperature (°C) that raises a warning. */
  tempAlertC: number;
  /** Board temperature (°C) that pauses the server. */
  tempShedC: number;
}

export type GuardEventKind = 'rps-alert' | 'shed-start' | 'shed-end' | 'ip-blocked' | 'temp-alert';

export interface GuardEvent {
  /** Epoch milliseconds. */
  at: number;
  kind: GuardEventKind;
  message: string;
}

/** The load guard right now (times in epoch milliseconds). */
export interface ServerStatus {
  rps: number;
  peakRps: number;
  peakAt: number | null;
  temperatureC: number | null;
  temperatureAt: number | null;
  shedding: boolean;
  shedUntil: number | null;
  shedReason: 'rps' | 'temperature' | null;
  totals: { allowed: number; ipBlocked: number; shed: number };
  /** When the counting started (the server's last start). */
  since: number;
  events: GuardEvent[];
  config: LoadGuardConfig;
}

export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  emailVerified: boolean;
  /** May turn on the VIP-only modules (always true for the owner). */
  vip: boolean;
  owner: boolean;
  /** Last time one of the account's open sessions was used; null when none is open (signing out ends it). */
  lastSeenAt: string | null;
}

/** A module and the owner's "Só VIP" choice for it. */
export interface AdminModule {
  key: ModuleKey;
  /** Only VIP accounts can turn it on. */
  vipOnly: boolean;
  /** Accounts without VIP that have it on now: making it "Só VIP" turns it off for them. */
  usersWithoutVip: number;
}

/**
 * How one automatic test came out. `warn` is something the Capital itself can't fix — a free
 * outside service (B3, Yahoo, Google) that did not answer, or something worth a look —, `skip` a
 * test with nothing to test on this server (the AI not set up, no bank connected).
 */
export type SelfTestStatus = 'ok' | 'warn' | 'fail' | 'skip';

/** What a test is about: the server itself or one module. */
export type SelfTestArea = 'server' | ModuleKey;

export interface SelfTestResult {
  /** Stable across runs ("card.bill"): what tells a new failure from one already warned about. */
  id: string;
  area: SelfTestArea;
  name: string;
  status: SelfTestStatus;
  /** What went wrong, or why it was skipped; null when it passed. */
  message: string | null;
  durationMs: number;
}

/** Why a run happened: the server starting, the hourly round, or "Rodar agora". */
export type SelfTestTrigger = 'start' | 'schedule' | 'manual';

export interface SelfTestRun {
  id: string;
  trigger: SelfTestTrigger;
  startedAt: string;
  finishedAt: string;
  results: SelfTestResult[];
}

/** The automatic tests, as Administração shows them. */
export interface SelfTestOverview {
  last: SelfTestRun | null;
  /** A run is going on right now. */
  running: boolean;
  /** When the next hourly run starts; null when they don't run on this server (SCHEDULER=off). */
  nextAt: string | null;
  /** The runs before the last one, newest first. */
  history: { id: string; startedAt: string; failed: number; warned: number }[];
}

export interface AdminOverview {
  status: ServerStatus;
  users: AdminUser[];
  /** Every module, in catalog order. */
  modules: AdminModule[];
  tests: SelfTestOverview;
}
