import { describe, expect, it } from 'vitest';
import { connectionHealth, consentDaysLeft, reserveStatusLine } from '..';

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

describe('the line under "Reserva em conta"', () => {
  const source = (marked: boolean) => ({
    id: 'a',
    kind: 'account' as const,
    name: 'Conta',
    detail: 'conta',
    usual: true,
    balance: 10,
    marked,
  });
  const bank = (name: string, lastUpdatedAt: string, marked = true) => ({
    itemId: name,
    name,
    status: 'ok' as const,
    lastUpdatedAt,
    sources: [source(marked)],
  });

  it('says from where and how long ago, without guessing a gender for the bank', () => {
    expect(
      reserveStatusLine({ total: 10, banks: [bank('Caixa', hoursAgo(5)), bank('BTG', hoursAgo(2))] }, now),
    ).toEqual({ text: 'Caixa e BTG · atualizado há 5 h', warning: false });
  });

  it('warns that the value is the last one that came when a bank stopped', () => {
    expect(reserveStatusLine({ total: 10, banks: [bank('Caixa', '2026-10-17T13:00:00Z')] }, now)).toEqual({
      text: 'Caixa: sem dados novos; o valor é o último que chegou, de 17/10.',
      warning: true,
    });
  });

  it('is nothing while the person types the reserve', () => {
    expect(reserveStatusLine({ total: null, banks: [bank('Caixa', hoursAgo(1), false)] }, now)).toBeNull();
  });
});
