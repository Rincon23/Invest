import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  admitRequest,
  ALERT_COOLDOWN_MS,
  loadGuardSnapshot,
  refreshTemperature,
  resetLoadGuard,
  setAlertHandler,
  type GuardEvent,
} from '../loadGuard';

const ENV = {
  LOAD_ALERT_RPS: '5',
  LOAD_SHED_RPS: '10',
  LOAD_SHED_SECONDS: '30',
  LOAD_IP_PER_MINUTE: '30',
  LOAD_IP_PER_10S: '20',
  TEMP_ALERT_C: '75',
  TEMP_SHED_C: '85',
};

/** `perSecond` requests a second for `seconds` seconds, each from its own IP unless `ip` is given. */
function traffic(start: number, seconds: number, perSecond: number, ip?: string) {
  const verdicts = [];
  for (let s = 0; s < seconds; s++) {
    for (let i = 0; i < perSecond; i++) {
      const now = start + s * 1000 + Math.floor((i * 1000) / perSecond);
      verdicts.push(admitRequest(ip ?? `10.0.${s}.${i}`, now));
    }
  }
  return verdicts;
}

describe('loadGuard', () => {
  let alerts: GuardEvent[];
  const T0 = 1_000_000_000;

  beforeEach(() => {
    Object.assign(process.env, ENV);
    resetLoadGuard(T0);
    alerts = [];
    setAlertHandler((event) => alerts.push(event));
  });

  afterEach(() => {
    for (const key of Object.keys(ENV)) delete process.env[key];
  });

  it('lets normal traffic through without any warning', () => {
    const verdicts = traffic(T0, 10, 2);
    expect(verdicts.every((v) => v.action === 'allow')).toBe(true);
    expect(alerts).toEqual([]);
    expect(loadGuardSnapshot(T0 + 10_000).shedding).toBe(false);
  });

  it('warns once when traffic crosses the alert line, without pausing', () => {
    const verdicts = traffic(T0, 10, 6);
    expect(verdicts.every((v) => v.action === 'allow')).toBe(true);
    expect(alerts.map((a) => a.kind)).toEqual(['rps-alert']);
  });

  it('blocks only the IP that floods, and only until its minute ends', () => {
    const flood = traffic(T0, 1, 150, '203.0.113.9');
    expect(flood.filter((v) => v.action === 'block-ip')).toHaveLength(130);
    expect(admitRequest('198.51.100.1', T0 + 1500).action).toBe('allow');
    expect(admitRequest('203.0.113.9', T0 + 61_000).action).toBe('allow');
    expect(alerts.map((a) => a.kind)).toContain('ip-blocked');
  });

  it('never lets one address alone pause the server for everyone', () => {
    const flood = traffic(T0, 10, 100, '203.0.113.9');
    expect(flood.some((v) => v.action === 'shed')).toBe(false);
    expect(loadGuardSnapshot(T0 + 10_000).shedding).toBe(false);
    expect(admitRequest('198.51.100.1', T0 + 10_100).action).toBe('allow');
  });

  it('pauses everything past the critical line, keeps pausing while the flood goes on, then recovers', () => {
    const flood = traffic(T0, 10, 20);
    expect(flood.some((v) => v.action === 'shed')).toBe(true);
    expect(loadGuardSnapshot(T0 + 10_000)).toMatchObject({ shedding: true, shedReason: 'rps' });

    // The flood goes on: the pause is extended.
    traffic(T0 + 10_000, 40, 20);
    expect(admitRequest('198.51.100.1', T0 + 55_000).action).toBe('shed');

    // Quiet again: once the pause is over, requests are answered.
    expect(admitRequest('198.51.100.1', T0 + 50_000 + 31_000).action).toBe('allow');
    expect(alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(['shed-start', 'shed-end']));
  });

  it('does not repeat the same warning within the cooldown', () => {
    traffic(T0, 10, 6);
    traffic(T0 + 60_000, 10, 6);
    expect(alerts.filter((a) => a.kind === 'rps-alert')).toHaveLength(1);
    traffic(T0 + ALERT_COOLDOWN_MS + 60_000, 10, 6);
    expect(alerts.filter((a) => a.kind === 'rps-alert')).toHaveLength(2);
  });

  it('warns when the board is hot and pauses when it reaches the critical temperature', async () => {
    await refreshTemperature(T0, async () => 78);
    expect(alerts.map((a) => a.kind)).toEqual(['temp-alert']);
    expect(admitRequest('198.51.100.1', T0 + 100).action).toBe('allow');

    await refreshTemperature(T0 + 10_000, async () => 86);
    expect(admitRequest('198.51.100.1', T0 + 10_100)).toMatchObject({ action: 'shed' });
    expect(loadGuardSnapshot(T0 + 10_100)).toMatchObject({ shedReason: 'temperature', temperatureC: 86 });
  });
});
