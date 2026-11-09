import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECURRING_SETTINGS,
  launchesFromPlans,
  recurringChecklist,
  recurringDueDate,
  recurringDueLabel,
  recurringNoticeBody,
  recurringNoticeDays,
  type RecurringLaunch,
} from '../recurring';
import type { InstallmentPlan, RecurringExpense } from '../types';

const bill = (id: string, amount: number, dueDay?: number): RecurringExpense => ({
  id,
  categoryKind: 'fixedCost',
  description: id,
  amount,
  card: false,
  ...(dueDay ? { dueDay } : {}),
});

describe('dia do vencimento', () => {
  it('cai no último dia dos meses curtos', () => {
    expect(recurringDueDate('2026-10', 10)).toBe('2026-10-10');
    expect(recurringDueDate('2026-02', 31)).toBe('2026-02-28');
    expect(recurringDueDate('2028-02', 30)).toBe('2028-02-29');
    expect(recurringDueDate('2026-04', 31)).toBe('2026-04-30');
  });
});

describe('Contas do mês', () => {
  const items = [bill('Internet', 120), bill('Aluguel', 1500, 5), bill('Luz', 180, 20), bill('Escola', 900, 10)];

  it('separa o que falta do que já foi lançado, a próxima a vencer primeiro', () => {
    const launches: RecurringLaunch[] = [
      { recurringId: 'Escola', month: '2026-10', date: '2026-10-08' },
      // Launched in another month: does not count for October.
      { recurringId: 'Luz', month: '2026-09', date: '2026-09-20' },
    ];
    const checklist = recurringChecklist(items, launches, '2026-10', '2026-10-19');
    expect(checklist.pending.map((status) => status.item.id)).toEqual(['Aluguel', 'Luz', 'Internet']);
    expect(checklist.done.map((status) => [status.item.id, status.launchedOn])).toEqual([['Escola', '2026-10-08']]);
    expect(checklist.pendingTotal).toBe(1800);
    expect(checklist.total).toBe(2700);
  });

  it('diz quantos dias faltam (ou passaram) do vencimento', () => {
    const checklist = recurringChecklist(items, [], '2026-10', '2026-10-17');
    const byId = Object.fromEntries(checklist.pending.map((status) => [status.item.id, status]));
    expect(recurringDueLabel(byId.Aluguel)).toBe('venceu dia 5');
    expect(recurringDueLabel(byId.Luz)).toBe('vence dia 20');
    expect(recurringDueLabel(byId.Internet)).toBeNull();
    expect(recurringDueLabel({ dueDate: '2026-10-19', daysUntilDue: 0 })).toBe('vence hoje');
    expect(recurringDueLabel({ dueDate: '2026-10-20', daysUntilDue: 1 })).toBe('vence amanhã');
  });

  it('duas vezes lançada no mesmo mês conta pela primeira', () => {
    const launches: RecurringLaunch[] = [
      { recurringId: 'Luz', month: '2026-10', date: '2026-10-21' },
      { recurringId: 'Luz', month: '2026-10', date: '2026-10-20' },
    ];
    const checklist = recurringChecklist(items, launches, '2026-10', '2026-10-21');
    expect(checklist.done[0].launchedOn).toBe('2026-10-20');
  });

  it('uma compra parcelada feita a partir da conta conta no mês da compra', () => {
    const plan: InstallmentPlan = {
      id: 'p1',
      name: 'Seguro',
      categoryKind: 'fixedCost',
      firstDebitDate: '2026-11-05',
      purchaseDate: '2026-10-12',
      count: 10,
      totalAmount: 1000,
      accounting: 'installment',
      recurringId: 'Seguro',
    };
    expect(launchesFromPlans([plan, { ...plan, id: 'p2', recurringId: undefined }])).toEqual([
      { recurringId: 'Seguro', month: '2026-10', date: '2026-10-12' },
    ]);
  });
});

describe('avisos das Contas do mês', () => {
  const items = [bill('Aluguel', 1500, 5), bill('Luz', 180, 30), bill('Internet', 120)];

  it('avisa no dia e nos três dias seguintes, enquanto não for lançada', () => {
    const days = recurringNoticeDays(items, [], DEFAULT_RECURRING_SETTINGS, '2026-10');
    const aluguel = days.filter((day) => day.item.id === 'Aluguel' && day.month === '2026-10');
    expect(aluguel.map((day) => [day.kind, day.date])).toEqual([
      ['due', '2026-10-05'],
      ['late', '2026-10-06'],
      ['late', '2026-10-07'],
      ['late', '2026-10-08'],
    ]);
    // A bill with no day never notifies.
    expect(days.some((day) => day.item.id === 'Internet')).toBe(false);
  });

  it('o atraso de uma conta do fim do mês passa para o mês seguinte', () => {
    const days = recurringNoticeDays(items, [], DEFAULT_RECURRING_SETTINGS, '2026-10');
    const septemberLuz = days.filter((day) => day.item.id === 'Luz' && day.month === '2026-09');
    expect(septemberLuz.map((day) => day.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('não avisa do que já foi lançado, nem quando a pessoa desligou o aviso', () => {
    const launched: RecurringLaunch[] = [{ recurringId: 'Aluguel', month: '2026-10', date: '2026-10-04' }];
    const days = recurringNoticeDays(items, launched, DEFAULT_RECURRING_SETTINGS, '2026-10');
    expect(days.some((day) => day.item.id === 'Aluguel' && day.month === '2026-10')).toBe(false);
    expect(recurringNoticeDays(items, [], { ...DEFAULT_RECURRING_SETTINGS, notifyEnabled: false }, '2026-10')).toEqual(
      [],
    );
    const once = recurringNoticeDays(items, [], { ...DEFAULT_RECURRING_SETTINGS, repeatUntilLaunched: false }, '2026-10');
    expect(once.every((day) => day.kind === 'due')).toBe(true);
  });

  it('o texto diz quando venceu', () => {
    expect(recurringNoticeBody({ kind: 'due', dueDate: '2026-10-05', date: '2026-10-05' }, 'R$ 1.500,00')).toBe(
      'Vence hoje: R$ 1.500,00. Toque em Lançar quando pagar.',
    );
    expect(recurringNoticeBody({ kind: 'late', dueDate: '2026-10-05', date: '2026-10-06' }, 'R$ 10,00')).toBe(
      'Venceu ontem (dia 5): R$ 10,00. Ainda não foi lançada.',
    );
    expect(recurringNoticeBody({ kind: 'late', dueDate: '2026-10-05', date: '2026-10-08' }, 'R$ 10,00')).toContain(
      'Venceu há 3 dias',
    );
  });
});
