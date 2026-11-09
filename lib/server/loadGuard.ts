import { readdir, readFile } from 'node:fs/promises';
import type { GuardEvent, GuardEventKind, LoadGuardConfig, ServerStatus } from '../admin/types';
import { UNKNOWN_IP } from './clientIp';

/**
 * Keeps the Orange Pi from going down or overheating. `proxy.ts` asks it about every request
 * (pages and API; static files never get there) and it answers one of three things:
 *
 * - **allow**;
 * - **block-ip**: this one address went over LOAD_IP_PER_10S requests in 10 seconds or
 *   LOAD_IP_PER_MINUTE in a minute. Only it gets a 429 until that window ends; everyone else carries
 *   on. The 10-second limit is well below the pause line, so one address alone can never pause the
 *   server for everybody — that takes many at once;
 * - **shed**: the whole server is taking a break. Once the average over the last few seconds reaches
 *   LOAD_SHED_RPS requests per second — or the board reaches TEMP_SHED_C degrees — every request
 *   gets a 503 for LOAD_SHED_SECONDS. A 503 costs almost nothing to send, so the board cools down;
 *   while the flood (or the heat) goes on, the break keeps being extended.
 *
 * Crossing the lower lines (LOAD_ALERT_RPS, TEMP_ALERT_C) only warns. Every warning and every break
 * becomes an event (listed in Administração) and is handed to `onAlert`, which the server wires to
 * a notification for its owner (lib/server/alerts.ts), at most once per ALERT_COOLDOWN_MS per kind.
 *
 * The state lives on `globalThis`: the proxy and the route handlers run in the same process and
 * see the same object, so the Administração screen reads exactly what the proxy counted.
 */

export type { GuardEvent, GuardEventKind, LoadGuardConfig };

export type Verdict =
  | { action: 'allow' }
  | { action: 'block-ip'; retryAfterSeconds: number }
  | { action: 'shed'; retryAfterSeconds: number };

/** Seconds the requests-per-second average is taken over. */
const RPS_WINDOW_S = 5;
const RING_SIZE = 16;
const IP_WINDOW_MS = 60_000;
const IP_BURST_WINDOW_MS = 10_000;
const MAX_TRACKED_IPS = 20_000;
const TEMPERATURE_TTL_MS = 5_000;
const MAX_EVENTS = 40;
export const ALERT_COOLDOWN_MS = 15 * 60_000;
const THERMAL_DIR = '/sys/class/thermal';

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}

export function loadGuardConfig(): LoadGuardConfig {
  return {
    alertRps: numberEnv('LOAD_ALERT_RPS', 20, 1, 10_000),
    shedRps: numberEnv('LOAD_SHED_RPS', 50, 1, 10_000),
    shedSeconds: numberEnv('LOAD_SHED_SECONDS', 60, 5, 3600),
    ipPerMinute: numberEnv('LOAD_IP_PER_MINUTE', 600, 10, 100_000),
    ipPer10s: numberEnv('LOAD_IP_PER_10S', 100, 5, 100_000),
    tempAlertC: numberEnv('TEMP_ALERT_C', 75, 30, 120),
    tempShedC: numberEnv('TEMP_SHED_C', 85, 30, 120),
  };
}

interface State {
  config: LoadGuardConfig;
  /** Requests counted per second: slot = second % RING_SIZE, stamped with that second. */
  ring: { second: number; count: number }[];
  ips: Map<string, IpWindow>;
  shedUntil: number;
  shedReason: 'rps' | 'temperature' | null;
  temperature: { celsius: number | null; readAt: number; reading: boolean };
  peak: { rps: number; at: number | null };
  totals: { allowed: number; ipBlocked: number; shed: number };
  since: number;
  events: GuardEvent[];
  lastAlertAt: Partial<Record<GuardEventKind, number>>;
  /** Set by the server at start-up (instrumentation.ts): tells the owner. */
  onAlert?: (event: GuardEvent) => void;
}

/** One address's counts: a minute window and a 10-second one (for bursts). */
interface IpWindow {
  count: number;
  resetAt: number;
  burst: number;
  burstResetAt: number;
  reported: boolean;
}

const globalForGuard = globalThis as unknown as { __capitalLoadGuard?: State };

function freshState(now: number): State {
  return {
    config: loadGuardConfig(),
    ring: Array.from({ length: RING_SIZE }, () => ({ second: -1, count: 0 })),
    ips: new Map(),
    shedUntil: 0,
    shedReason: null,
    temperature: { celsius: null, readAt: 0, reading: false },
    peak: { rps: 0, at: null },
    totals: { allowed: 0, ipBlocked: 0, shed: 0 },
    since: now,
    events: [],
    lastAlertAt: {},
  };
}

function state(now = Date.now()): State {
  globalForGuard.__capitalLoadGuard ??= freshState(now);
  return globalForGuard.__capitalLoadGuard;
}

/** For tests: forget everything (and read the env again). */
export function resetLoadGuard(now = Date.now()): void {
  globalForGuard.__capitalLoadGuard = freshState(now);
}

export function setAlertHandler(handler: (event: GuardEvent) => void): void {
  state().onAlert = handler;
}

function record(s: State, kind: GuardEventKind, message: string, now: number, alert: boolean): void {
  const event: GuardEvent = { at: now, kind, message };
  s.events.unshift(event);
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
  console.warn(`[carga] ${message}`);
  if (!alert) return;
  const last = s.lastAlertAt[kind];
  if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return;
  s.lastAlertAt[kind] = now;
  try {
    s.onAlert?.(event);
  } catch (err) {
    console.error('[carga] falha ao avisar:', err);
  }
}

/** Only warns again once the cooldown for that kind of warning is over. */
function warnOnce(s: State, kind: GuardEventKind, message: string, now: number): void {
  const last = s.lastAlertAt[kind];
  if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return;
  record(s, kind, message, now, true);
}

function count(s: State, now: number): void {
  const second = Math.floor(now / 1000);
  const slot = s.ring[second % RING_SIZE];
  if (slot.second !== second) {
    slot.second = second;
    slot.count = 0;
  }
  slot.count += 1;
}

function averageRps(s: State, now: number): number {
  const second = Math.floor(now / 1000);
  let total = 0;
  for (const slot of s.ring) {
    if (slot.second > second - RPS_WINDOW_S && slot.second <= second) total += slot.count;
  }
  return total / RPS_WINDOW_S;
}

function startShed(s: State, reason: 'rps' | 'temperature', detail: string, now: number): void {
  const until = now + s.config.shedSeconds * 1000;
  const alreadyShedding = s.shedUntil > now;
  s.shedUntil = Math.max(s.shedUntil, until);
  if (alreadyShedding) return;
  s.shedReason = reason;
  record(
    s,
    'shed-start',
    `Servidor pausado por ${s.config.shedSeconds} s: ${detail}. Todas as requisições recebem "volte em instantes" até normalizar.`,
    now,
    true,
  );
}

function endShedIfOver(s: State, now: number): void {
  if (s.shedReason === null || s.shedUntil > now) return;
  const reason = s.shedReason;
  s.shedReason = null;
  record(
    s,
    'shed-end',
    reason === 'temperature'
      ? 'A temperatura baixou: o servidor voltou a atender.'
      : 'O pico de acessos passou: o servidor voltou a atender.',
    now,
    true,
  );
}

/** Temperature rules, checked on every request and by the monitor (so heat is noticed even with no traffic). */
function checkTemperature(s: State, now: number): void {
  const celsius = s.temperature.celsius;
  if (celsius === null) return;
  if (celsius >= s.config.tempShedC) {
    startShed(
      s,
      'temperature',
      `a placa chegou a ${celsius.toFixed(0)} °C (limite ${s.config.tempShedC} °C)`,
      now,
    );
  } else if (celsius >= s.config.tempAlertC) {
    warnOnce(
      s,
      'temp-alert',
      `A placa está a ${celsius.toFixed(0)} °C (alerta a partir de ${s.config.tempAlertC} °C; pausa em ${s.config.tempShedC} °C).`,
      now,
    );
  }
}

/** The hottest of the board's thermal zones, in °C; null where there are none (Windows, a VM). */
export async function readBoardTemperature(dir = THERMAL_DIR): Promise<number | null> {
  try {
    const zones = (await readdir(dir)).filter((name) => name.startsWith('thermal_zone'));
    const readings = await Promise.all(
      zones.map(async (zone) => {
        const raw = Number((await readFile(`${dir}/${zone}/temp`, 'utf8')).trim());
        // Millidegrees on Linux; a few drivers report whole degrees.
        return Number.isFinite(raw) ? (raw > 1000 ? raw / 1000 : raw) : null;
      }),
    );
    const valid = readings.filter((value): value is number => value !== null && value > 0 && value < 150);
    return valid.length > 0 ? Math.max(...valid) : null;
  } catch {
    return null;
  }
}

/** Reads the temperature again when the last reading is older than a few seconds (never waits for it). */
export function refreshTemperature(
  now = Date.now(),
  read: () => Promise<number | null> = readBoardTemperature,
): Promise<void> {
  const s = state(now);
  if (s.temperature.reading || now - s.temperature.readAt < TEMPERATURE_TTL_MS) return Promise.resolve();
  s.temperature.reading = true;
  return read()
    .then((celsius) => {
      s.temperature = { celsius, readAt: now, reading: false };
      checkTemperature(s, now);
    })
    .catch(() => {
      s.temperature.reading = false;
    });
}

/** The proxy's question: may this request go through? */
export function admitRequest(ip: string, now = Date.now()): Verdict {
  const s = state(now);
  void refreshTemperature(now);

  // One address flooding only locks itself out. An unknown IP (no trusted header) is not limited
  // here: every visitor would share it. The global limit below still covers it.
  if (ip !== UNKNOWN_IP) {
    let window = s.ips.get(ip);
    if (!window || window.resetAt <= now) {
      if (window) s.ips.delete(ip);
      window = {
        count: 0,
        resetAt: now + IP_WINDOW_MS,
        burst: 0,
        burstResetAt: now + IP_BURST_WINDOW_MS,
        reported: false,
      };
      s.ips.set(ip, window);
      if (s.ips.size > MAX_TRACKED_IPS) pruneIps(s, now);
    }
    if (window.burstResetAt <= now) {
      window.burst = 0;
      window.burstResetAt = now + IP_BURST_WINDOW_MS;
    }
    window.count += 1;
    window.burst += 1;
    const overMinute = window.count > s.config.ipPerMinute;
    const overBurst = window.burst > s.config.ipPer10s;
    if (overMinute || overBurst) {
      s.totals.ipBlocked += 1;
      if (!window.reported) {
        window.reported = true;
        record(
          s,
          'ip-blocked',
          overBurst
            ? `O IP ${ip} fez mais de ${s.config.ipPer10s} requisições em 10 segundos e foi bloqueado por alguns segundos.`
            : `O IP ${ip} passou de ${s.config.ipPerMinute} requisições em um minuto e foi bloqueado até o minuto acabar.`,
          now,
          true,
        );
      }
      const until = overMinute ? window.resetAt : window.burstResetAt;
      return { action: 'block-ip', retryAfterSeconds: Math.max(1, Math.ceil((until - now) / 1000)) };
    }
  }

  count(s, now);
  const rps = averageRps(s, now);
  if (rps > s.peak.rps) s.peak = { rps, at: now };

  checkTemperature(s, now);
  if (rps >= s.config.shedRps) {
    startShed(s, 'rps', `${rps.toFixed(0)} requisições por segundo (limite ${s.config.shedRps})`, now);
  } else if (rps >= s.config.alertRps) {
    warnOnce(
      s,
      'rps-alert',
      `Acesso alto: ${rps.toFixed(0)} requisições por segundo (alerta a partir de ${s.config.alertRps}; pausa em ${s.config.shedRps}).`,
      now,
    );
  }

  if (s.shedUntil > now) {
    s.totals.shed += 1;
    return { action: 'shed', retryAfterSeconds: Math.max(1, Math.ceil((s.shedUntil - now) / 1000)) };
  }
  endShedIfOver(s, now);
  s.totals.allowed += 1;
  return { action: 'allow' };
}

function pruneIps(s: State, now: number): void {
  for (const [ip, window] of s.ips) if (window.resetAt <= now) s.ips.delete(ip);
  for (const ip of s.ips.keys()) {
    if (s.ips.size <= MAX_TRACKED_IPS * 0.9) break;
    s.ips.delete(ip);
  }
}

/** Checks the temperature every few seconds even when nobody is using the app. */
export function startLoadGuardMonitor(intervalMs = 15_000): void {
  const g = globalThis as unknown as { __capitalLoadGuardMonitor?: ReturnType<typeof setInterval> };
  if (g.__capitalLoadGuardMonitor) return;
  g.__capitalLoadGuardMonitor = setInterval(() => {
    const now = Date.now();
    void refreshTemperature(now).then(() => endShedIfOver(state(), Date.now()));
  }, intervalMs);
  g.__capitalLoadGuardMonitor.unref?.();
}

export function loadGuardSnapshot(now = Date.now()): ServerStatus {
  const s = state(now);
  endShedIfOver(s, now);
  return {
    rps: averageRps(s, now),
    peakRps: s.peak.rps,
    peakAt: s.peak.at,
    temperatureC: s.temperature.celsius,
    temperatureAt: s.temperature.readAt || null,
    shedding: s.shedUntil > now,
    shedUntil: s.shedUntil > now ? s.shedUntil : null,
    shedReason: s.shedUntil > now ? s.shedReason : null,
    totals: { ...s.totals },
    since: s.since,
    events: [...s.events],
    config: { ...s.config },
  };
}
