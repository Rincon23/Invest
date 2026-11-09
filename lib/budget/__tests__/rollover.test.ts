import { describe, expect, it } from 'vitest';
import { computeMonthSummary } from '../calculations';
import { carrySource, cascadeCarryIn, lastMonthWithAllClosed, lateExpenseDestination } from '../rollover';
import type { MonthData, TopicConfig } from '../types';

const TOPICS: TopicConfig[] = [{ id: 'diversos', name: 'Diversos', targetPct: 1, order: 0 }];

function month(key: string, changes: Partial<MonthData> = {}): MonthData {
  return {
    month: key,
    incomes: [{ id: `i-${key}`, source: 'Salário', amount: 100 }],
    expenses: [],
    carryIn: { diversos: 0 },
    topicsSnapshot: TOPICS,
    ...changes,
  };
}

const carried = (list: MonthData[]) => cascadeCarryIn(list, computeMonthSummary).map((m) => m.carryIn.diversos);

describe('sobra entre os meses', () => {
  it('só passa de um mês fechado, e fechado trazendo', () => {
    expect(carrySource(undefined, computeMonthSummary)).toBeNull();
    expect(carrySource(month('2026-01'), computeMonthSummary)).toBeNull();
    expect(carrySource(month('2026-01', { closed: true, leftoversDropped: true }), computeMonthSummary)).toBeNull();
    expect(carrySource(month('2026-01', { closed: true }), computeMonthSummary)?.balance).toBe(100);
  });

  it('um mês aberto no meio do caminho zera o que vem depois dele', () => {
    const chain = [
      month('2026-01', { closed: true }),
      month('2026-02'),
      month('2026-03', { carryIn: { diversos: 999 } }),
    ];
    expect(carried(chain)).toEqual([0, 100, 0]);
  });

  it('o primeiro mês guarda o saldo com que começou', () => {
    expect(carried([month('2026-01', { closed: true, carryIn: { diversos: 50 } }), month('2026-02')])).toEqual([
      50, 150,
    ]);
  });

  it('a prévia de fechar todos soma os meses sem mudar os que vieram', () => {
    const chain = [
      month('2026-01'),
      month('2026-02', { closed: true, leftoversDropped: true }),
      month('2026-03'),
      month('2026-04'),
    ];
    const last = lastMonthWithAllClosed(chain, computeMonthSummary)!;
    // January goes on to February, which keeps its "Não trazer"; March starts over.
    expect(last.month).toBe('2026-04');
    expect(last.carryIn.diversos).toBe(100);
    expect(chain[3].closed).toBeUndefined();
    expect(lastMonthWithAllClosed([], computeMonthSummary)).toBeUndefined();
  });
});

describe('gasto com data de um mês anterior', () => {
  const status = (month: string, closed = false, leftoversDropped = false) => ({ month, closed, leftoversDropped });

  it('vai para o mês da data, fechado ou não, dizendo se a sobra dele chega até aqui', () => {
    expect(lateExpenseDestination('2026-11', '2026-10-28', [status('2026-10', true), status('2026-11')])).toEqual({
      month: '2026-10',
      closed: true,
      reachesFrom: true,
    });
    expect(lateExpenseDestination('2026-11', '2026-10-28', [status('2026-10', true, true)])).toEqual({
      month: '2026-10',
      closed: true,
      reachesFrom: false,
    });
    expect(lateExpenseDestination('2026-11', '2026-10-28', [status('2026-10')])).toEqual({
      month: '2026-10',
      closed: false,
      reachesFrom: false,
    });
  });

  it('a sobra só chega se todos os meses do caminho foram fechados trazendo', () => {
    const way = [status('2026-08', true), status('2026-09', true), status('2026-11')];
    expect(lateExpenseDestination('2026-11', '2026-08-15', way)?.reachesFrom).toBe(true);
    way[1] = status('2026-09');
    expect(lateExpenseDestination('2026-11', '2026-08-15', way)?.reachesFrom).toBe(false);
  });

  it('fica onde foi lançado: mesmo mês, mês depois, mês nunca usado ou lançado num mês fechado', () => {
    const months = [status('2026-09', true), status('2026-11')];
    expect(lateExpenseDestination('2026-11', '2026-11-02', months)).toBeNull();
    expect(lateExpenseDestination('2026-11', '2026-12-02', months)).toBeNull();
    expect(lateExpenseDestination('2026-11', '2026-10-02', months)).toBeNull();
    expect(lateExpenseDestination('2026-10', '2026-09-02', [status('2026-09', true), status('2026-10', true)])).toBeNull();
  });
});
