import { describe, expect, it } from 'vitest';
import { alertSettingsOf, DEFAULT_BANK_ALERTS, reviewAlertBody, reviewAlertUrl } from '..';

describe('the alert after a bank updates', () => {
  const news = (expenses: number, incomes: number, month = '2026-10') => ({ month, expenses, incomes });

  it('says how many are missing in the Capital, in plain words, and nothing when nothing is', () => {
    expect(reviewAlertBody([news(3, 1)], DEFAULT_BANK_ALERTS)).toBe('3 gastos e 1 recebimento para conferir.');
    expect(reviewAlertBody([news(1, 0), news(0, 2, '2026-09')], DEFAULT_BANK_ALERTS)).toBe(
      '1 gasto e 2 recebimentos para conferir.',
    );
    expect(reviewAlertBody([news(0, 0)], DEFAULT_BANK_ALERTS)).toBeNull();
    expect(reviewAlertBody([news(3, 1)], DEFAULT_BANK_ALERTS)).not.toMatch(/agora|na hora|tempo real/i);
  });

  it('follows the switches', () => {
    const onlyIncomes = { ...DEFAULT_BANK_ALERTS, expenses: false };
    expect(reviewAlertBody([news(3, 1)], onlyIncomes)).toBe('1 recebimento para conferir.');
    expect(reviewAlertBody([news(3, 0)], onlyIncomes)).toBeNull();
  });

  it('opens the tab with more, in last month only when everything new is from it', () => {
    expect(reviewAlertUrl('/bancos/conferir', [news(3, 1)], DEFAULT_BANK_ALERTS, '2026-10')).toBe(
      '/bancos/conferir?tipo=gastos',
    );
    expect(reviewAlertUrl('/bancos/conferir', [news(0, 0, '2026-09'), news(1, 2)], DEFAULT_BANK_ALERTS, '2026-10')).toBe(
      '/bancos/conferir?tipo=recebimentos',
    );
    expect(reviewAlertUrl('/bancos/conferir', [news(2, 0, '2026-09'), news(0, 0)], DEFAULT_BANK_ALERTS, '2026-10')).toBe(
      '/bancos/conferir?tipo=gastos&mes=2026-09',
    );
  });

  it('reads older settings: money out from purchases or Pix sent, money in from Pix received', () => {
    expect(alertSettingsOf({ purchases: false, pixSent: true, pixReceived: false, minAmount: 30 })).toEqual({
      expenses: true,
      incomes: false,
      silent: false,
    });
    expect(alertSettingsOf({ purchases: false, pixSent: false, pixReceived: true, minAmount: null })).toEqual({
      expenses: false,
      incomes: true,
      silent: false,
    });
    // An even older save, with the salary alert the owner took out.
    expect(alertSettingsOf({ purchases: false, salary: true })).toEqual({ expenses: true, incomes: true, silent: false });
    expect(alertSettingsOf({ expenses: false, incomes: true, silent: true })).toEqual({
      expenses: false,
      incomes: true,
      silent: true,
    });
    expect(alertSettingsOf(null)).toEqual(DEFAULT_BANK_ALERTS);
  });
});
