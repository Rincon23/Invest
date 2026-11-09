import { describe, expect, it } from 'vitest';
import { connectionHealth, consentDaysLeft } from '..';

const now = new Date('2026-10-20T15:00:00Z').getTime();
const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();

describe('how a bank is doing', () => {
  it('counts as stopped after 48 h without data, even with Pluggy saying all is well', () => {
    expect(connectionHealth({ status: 'ok', lastUpdatedAt: hoursAgo(47) }, now)).toBe('ok');
    expect(connectionHealth({ status: 'ok', lastUpdatedAt: hoursAgo(49) }, now)).toBe('stale');
    expect(connectionHealth({ status: 'ok', lastUpdatedAt: null }, now)).toBe('ok');
  });

  it("keeps Pluggy's own trouble as it is", () => {
    expect(connectionHealth({ status: 'pending', lastUpdatedAt: null }, now)).toBe('pending');
    expect(connectionHealth({ status: 'error', lastUpdatedAt: hoursAgo(100) }, now)).toBe('error');
    expect(connectionHealth({ status: 'reconnect', lastUpdatedAt: hoursAgo(1) }, now)).toBe('reconnect');
  });

  it('warns 15 days before the authorization runs out', () => {
    const inDays = (days: number) => ({ consentExpiresAt: new Date(now + days * 86_400_000).toISOString() });
    expect(consentDaysLeft(inDays(16), now)).toBeNull();
    expect(consentDaysLeft(inDays(15), now)).toBe(15);
    expect(consentDaysLeft(inDays(0.5), now)).toBe(1);
    expect(consentDaysLeft(inDays(-3), now)).toBe(0);
    expect(consentDaysLeft({ consentExpiresAt: null }, now)).toBeNull();
  });
});
