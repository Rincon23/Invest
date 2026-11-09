import { describe, expect, it } from 'vitest';
import { formatMonthLabel, nextMonth, previousMonth, shiftMonth, todayISO } from '../date';

describe('date utils', () => {
  it('avança de dezembro para janeiro do ano seguinte', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('volta de janeiro para dezembro do ano anterior', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('desloca múltiplos meses', () => {
    expect(shiftMonth('2026-09', 5)).toBe('2027-02');
    expect(shiftMonth('2026-09', -12)).toBe('2025-09');
  });

  it('formata o rótulo em português', () => {
    expect(formatMonthLabel('2026-09')).toBe('Setembro 2026');
  });

  it('todayISO usa a data local, não UTC (22h30 continua sendo o mesmo dia)', () => {
    expect(todayISO(new Date(2026, 8, 15, 22, 30))).toBe('2026-09-15');
    expect(todayISO(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});
