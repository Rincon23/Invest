import { describe, expect, it } from 'vitest';
import {
  billDueDate,
  billNoticeDays,
  cardBills,
  cardLimitUse,
  DEFAULT_CARD_SETTINGS,
  dueLabel,
  lateBills,
  nextBankingDay,
  nextBillToPay,
  nextChargeDate,
  nominalDueDate,
  openBills,
  openCardDebt,
  UNASSIGNED_CARD_ID,
} from '../cards';
import type { CardBillPayment, CreditCard } from '../types';

function card(overrides: Partial<CreditCard> = {}): CreditCard {
  return {
    id: 'nubank',
    name: 'Nubank',
    dueDay: 10,
    dueMonth: 'next',
    notifyEnabled: true,
    notifyBeforeDays: 1,
    isDefault: true,
    order: 0,
    ...overrides,
  };
}

describe('vencimento da fatura', () => {
  it('vence no mês seguinte à competência, por padrão', () => {
    expect(nominalDueDate(card(), '2026-09')).toBe('2026-10-10');
    // 10/10/2026 cai num sábado, então a fatura é paga na segunda.
    expect(billDueDate(card(), '2026-09')).toBe('2026-10-12');
    expect(billDueDate(card(), '2026-10')).toBe('2026-11-10');
  });

  it('pode vencer no mesmo mês da competência', () => {
    expect(nominalDueDate(card({ dueMonth: 'same' }), '2026-09')).toBe('2026-09-10');
  });

  it('usa o último dia quando o mês não tem o dia escolhido', () => {
    expect(nominalDueDate(card({ dueDay: 31 }), '2026-01')).toBe('2026-02-28');
  });

  it('vencimento no sábado vai para a segunda', () => {
    // 2026-08-01 é um sábado.
    expect(nextBankingDay('2026-08-01')).toBe('2026-08-03');
    expect(billDueDate(card({ dueDay: 1 }), '2026-07')).toBe('2026-08-03');
  });

  it('vencimento no domingo vai para a segunda', () => {
    // 2026-08-02 é um domingo.
    expect(nextBankingDay('2026-08-02')).toBe('2026-08-03');
  });

  it('não mexe num dia útil', () => {
    expect(nextBankingDay('2026-08-03')).toBe('2026-08-03');
    expect(nextBankingDay('2026-08-07')).toBe('2026-08-07');
  });

  it('o adiamento pode atravessar o mês sem mudar a competência da fatura', () => {
    // 2026-05-31 é um domingo: a fatura de abril passa a ser paga em 01/06.
    const bills = cardBills(
      [card({ dueDay: 31 })],
      [{ month: '2026-04', cardId: 'nubank', total: 500 }],
      [],
      '2026-05-20',
    );
    expect(bills[0].month).toBe('2026-04');
    expect(bills[0].postponedFrom).toBe('2026-05-31');
    expect(bills[0].dueDate).toBe('2026-06-01');
  });
});

describe('fatura "Não informado"', () => {
  const totals = [{ month: '2026-09', cardId: UNASSIGNED_CARD_ID, total: 300 }];

  it('não sai sozinha na virada do mês: continua em aberto até ser marcada como paga', () => {
    const before = cardBills([], totals, [], '2026-09-30');
    expect(before).toHaveLength(1);
    expect(before[0].cardId).toBe(UNASSIGNED_CARD_ID);
    expect(before[0].cardName).toBe('Não informado');
    expect(before[0].dueDate).toBeNull();
    expect(dueLabel(before[0])).toBe('sem data de vencimento');
    expect(openCardDebt(before)).toBe(-300);

    // A virada do mês não muda nada: nenhuma fatura sai sozinha no Capital.
    const after = cardBills([], totals, [], '2026-10-05');
    expect(after[0].paid).toBe(false);
    expect(openCardDebt(after)).toBe(-300);
  });

  it('duas competências sem marcar nada aparecem somadas, cada uma na sua linha', () => {
    const bills = cardBills(
      [],
      [
        { month: '2026-09', cardId: UNASSIGNED_CARD_ID, total: 300 },
        { month: '2026-10', cardId: UNASSIGNED_CARD_ID, total: 120 },
      ],
      [],
      '2026-10-20',
    );
    expect(bills.map((bill) => bill.month)).toEqual(['2026-09', '2026-10']);
    expect(openCardDebt(bills)).toBe(-420);
  });

  it('sai da dívida quando é marcada como paga, e volta quando desfaz', () => {
    const payments: CardBillPayment[] = [
      { cardId: UNASSIGNED_CARD_ID, month: '2026-09', amount: 300, paidAt: '2026-10-02T12:00:00Z' },
    ];
    const paid = cardBills([], totals, payments, '2026-10-05');
    expect(paid[0].paid).toBe(true);
    expect(dueLabel(paid[0])).toBe('paga em 02/10');
    expect(openCardDebt(paid)).toBe(-0);
    expect(openCardDebt(cardBills([], totals, [], '2026-10-05'))).toBe(-300);
  });

  it('as compras de um cartão que não existe mais entram nela', () => {
    const bills = cardBills(
      [],
      [
        { month: '2026-09', cardId: UNASSIGNED_CARD_ID, total: 100 },
        { month: '2026-09', cardId: 'apagado', total: 50 },
      ],
      [],
      '2026-09-15',
    );
    expect(bills).toHaveLength(1);
    expect(bills[0].total).toBe(150);
  });
});

describe('competência futura', () => {
  it('não é fatura em aberto: é o que já está comprometido adiante', () => {
    const bills = cardBills(
      [card()],
      [
        { month: '2026-09', cardId: 'nubank', total: 200 },
        { month: '2026-11', cardId: 'nubank', total: 80 },
      ],
      [],
      '2026-09-15',
    );
    expect(bills.find((bill) => bill.month === '2026-11')?.future).toBe(true);
    expect(openBills(bills).map((bill) => bill.month)).toEqual(['2026-09']);
    expect(openCardDebt(bills)).toBe(-200);
  });
});

describe('limite do cartão', () => {
  it('desconta as faturas em aberto e as parcelas que ainda vão cair', () => {
    const use = cardLimitUse(5000, 1200, 320);
    expect(use.used).toBe(1520);
    expect(use.available).toBe(3480);
    expect(use.over).toBe(false);
    expect(use.usedPct).toBeCloseTo(0.304, 6);
  });

  it('estourado, diz quanto passou e enche a barra', () => {
    const use = cardLimitUse(1000, 900, 340);
    expect(use.available).toBe(-240);
    expect(use.over).toBe(true);
    expect(use.usedPct).toBe(1);
  });
});

describe('próxima cobrança do cartão', () => {
  it('é o dia do cartão nesta competência enquanto ele não passou', () => {
    // Vence dia 10 do mês seguinte: a cobrança de setembro é 10/10.
    expect(nextChargeDate(card(), '2026-09-15')).toBe('2026-10-10');
  });

  it('pula para a competência seguinte quando o dia já passou', () => {
    expect(nextChargeDate(card({ dueMonth: 'same' }), '2026-09-15')).toBe('2026-10-10');
  });
});

describe('fatura de cartão cadastrado', () => {
  const totals = [{ month: '2026-09', cardId: 'nubank', total: 1200 }];

  it('continua em aberto depois do vencimento, até marcar como paga', () => {
    const bills = cardBills([card()], totals, [], '2026-10-15');
    expect(bills[0].paid).toBe(false);
    expect(bills[0].daysUntilDue).toBeLessThan(0);
    expect(lateBills(bills)).toHaveLength(1);
    expect(openCardDebt(bills)).toBe(-1200);
    expect(dueLabel(bills[0])).toBe('atrasada há 3 dias');
  });

  it('sai da dívida quando é marcada como paga', () => {
    const payments: CardBillPayment[] = [
      { cardId: 'nubank', month: '2026-09', amount: 1200, paidAt: '2026-10-09T12:00:00Z' },
    ];
    const bills = cardBills([card()], totals, payments, '2026-10-15');
    expect(bills[0].paid).toBe(true);
    expect(openCardDebt(bills)).toBe(-0);
    expect(nextBillToPay(bills)).toBeNull();
  });

  it('soma as competências que ficaram em aberto ao mesmo tempo', () => {
    const bills = cardBills(
      [card()],
      [
        { month: '2026-08', cardId: 'nubank', total: 800 },
        { month: '2026-09', cardId: 'nubank', total: 1200 },
      ],
      [],
      '2026-10-05',
    );
    expect(bills.map((bill) => bill.month)).toEqual(['2026-08', '2026-09']);
    expect(openCardDebt(bills)).toBe(-2000);
    expect(nextBillToPay(bills)?.month).toBe('2026-08');
  });

  it('não mostra fatura zerada', () => {
    expect(cardBills([card()], [{ month: '2026-09', cardId: 'nubank', total: 0 }], [], '2026-09-10')).toEqual([]);
  });
});

describe('dias de aviso', () => {
  it('conta o aviso antecipado a partir do vencimento já adiado', () => {
    // 2026-08-01 (sábado) vira 2026-08-03; "1 dia antes" é o domingo 02.
    const days = billNoticeDays(card({ dueDay: 1, notifyBeforeDays: 1 }), '2026-07', DEFAULT_CARD_SETTINGS);
    expect(days.due).toBe('2026-08-03');
    expect(days.advance).toBe('2026-08-02');
    expect(days.late[0]).toBe('2026-08-04');
    expect(days.late).toHaveLength(7);
  });

  it('sem aviso antecipado quando a pessoa escolheu só no dia', () => {
    expect(billNoticeDays(card({ notifyBeforeDays: 0 }), '2026-09', DEFAULT_CARD_SETTINGS).advance).toBeNull();
  });

  it('não insiste quando a pessoa desligou a insistência', () => {
    const days = billNoticeDays(card(), '2026-09', { ...DEFAULT_CARD_SETTINGS, repeatUntilPaid: false });
    expect(days.late).toEqual([]);
  });
});
