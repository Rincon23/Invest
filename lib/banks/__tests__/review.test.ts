import { describe, expect, it } from 'vitest';
import type { CategoryOption } from '@/lib/categoryText';
import type { Expense, InstallmentPlan } from '@/lib/budget';
import {
  bankInstallmentIn,
  counterpartName,
  coverage,
  descriptionKey,
  documentKey,
  entryWhere,
  findUpfront,
  onExpectedCard,
  findDuplicate,
  findDuplicateIncome,
  findReimbursement,
  findSplit,
  isStrongReceived,
  groupInstallments,
  ignoreReason,
  matchingPlan,
  memoryKey,
  namesByDocument,
  rawCounterpart,
  shortName,
  paybackMemory,
  paybackTolerance,
  payerKey,
  planChargeIn,
  receivedCandidates,
  reimbursementCandidates,
  reviewKind,
  reviewMonths,
  strongPairs,
  suggestCategory,
  type ReviewTransaction,
} from '..';

let next = 0;
const tx = (overrides: Partial<ReviewTransaction>): ReviewTransaction => ({
  id: `t${(next += 1)}`,
  accountId: 'conta',
  accountKind: 'checking',
  date: '2026-10-18',
  amount: -10,
  type: 'DEBIT',
  description: 'ALGO',
  category: null,
  operationType: null,
  paymentMethod: null,
  payerName: null,
  receiverName: null,
  merchantName: null,
  installmentNumber: null,
  totalInstallments: null,
  purchaseDate: null,
  ...overrides,
});
const card = (overrides: Partial<ReviewTransaction>) =>
  tx({ accountId: 'cartao', accountKind: 'card', amount: 45.9, type: 'DEBIT', ...overrides });

describe('what each transaction suggests', () => {
  it('leaves out bill payments, own transfers, investments and card credits, saying why', () => {
    expect(ignoreReason(tx({ category: 'Credit card payment' }))).toBe('bill_payment');
    expect(ignoreReason(card({ amount: -1200, type: 'CREDIT', operationType: 'PAGAMENTO_FATURA' }))).toBe(
      'bill_payment',
    );
    expect(ignoreReason(tx({ category: 'Same person transfer' }))).toBe('own_transfer');
    expect(ignoreReason(tx({ operationType: 'TRANSFERENCIA_MESMA_INSTITUICAO' }))).toBe('own_transfer');
    expect(ignoreReason(tx({ operationType: 'RESGATE_APLIC_FINANCEIRA', type: 'CREDIT' }))).toBe('investment');
    expect(ignoreReason(tx({ category: 'Proceeds interests and dividends' }))).toBe('investment');
    expect(ignoreReason(card({ amount: -30, type: 'CREDIT', operationType: 'ESTORNO' }))).toBe('card_credit');
    expect(ignoreReason(card({}))).toBeNull();
    expect(ignoreReason(tx({ paymentMethod: 'PIX' }))).toBeNull();
  });

  it('a card purchase is an expense, split in instalments a plan; money in is an income', () => {
    expect(reviewKind(card({}))).toBe('expense');
    expect(reviewKind(card({ totalInstallments: 10, installmentNumber: 1 }))).toBe('plan');
    expect(reviewKind(tx({ type: 'CREDIT', amount: 50 }))).toBe('income');
    expect(reviewKind(tx({ type: 'DEBIT', amount: -50 }))).toBe('expense');
  });
});

describe('split purchases', () => {
  it('reads the same with or without the instalment number in the description', () => {
    expect(descriptionKey('LOJA X PARC 06/10')).toBe(descriptionKey('Loja X 07/10'));
    expect(descriptionKey('LOJA X 6 de 10')).toBe('loja x');
  });

  it('one line per purchase when the bank sends every instalment at once', () => {
    const instalments = Array.from({ length: 10 }, (_, index) =>
      card({
        description: `LOJA ${String(index + 1).padStart(2, '0')}/10`,
        amount: index === 0 ? 87.29 : 87.23,
        date: index === 0 ? '2026-02-09' : '2026-02-10',
        purchaseDate: '2026-02-09',
        installmentNumber: index + 1,
        totalInstallments: 10,
      }),
    );
    const [group] = groupInstallments(instalments);
    expect(group).toMatchObject({
      count: 10,
      installmentAmount: 87.23,
      total: 872.36,
      purchaseDate: '2026-02-09',
    });
    expect(group.transactions).toHaveLength(10);
  });

  it('and when it sends one a month, the total comes from the instalment', () => {
    const groups = groupInstallments([
      card({ description: 'CURSO 04/10', amount: 79.93, installmentNumber: 4, totalInstallments: 10, purchaseDate: '2025-09-08' }),
      card({ description: 'OUTRA 02/03', amount: 20, installmentNumber: 2, totalInstallments: 3, purchaseDate: '2026-09-01' }),
    ]);
    expect(groups.map((group) => [group.count, group.total, group.numbers])).toEqual([
      [10, 799.3, [4]],
      [3, 60, [2]],
    ]);
  });

  it('knows the purchase already registered, by card, count, instalment and day', () => {
    const plan: InstallmentPlan = {
      id: 'plano',
      name: 'Curso',
      categoryKind: 'topic',
      topicId: 'educacao',
      firstDebitDate: '2025-10-09',
      purchaseDate: '2025-09-07',
      count: 10,
      totalAmount: 799.3,
      accounting: 'installment',
      cardId: 'nubank',
    };
    const [group] = groupInstallments([
      card({ description: 'CURSO 04/10', amount: 79.93, installmentNumber: 4, totalInstallments: 10, purchaseDate: '2025-09-08' }),
    ]);
    expect(matchingPlan(group, [plan], 'nubank')).toBe(plan);
    expect(matchingPlan(group, [plan], 'outro-cartao')).toBeNull();
    expect(matchingPlan(group, [{ ...plan, count: 12 }], 'nubank')).toBeNull();
    expect(matchingPlan(group, [{ ...plan, purchaseDate: '2025-08-01' }], 'nubank')).toBeNull();
  });
});

describe("the month's instalment", () => {
  // As the dev database has them: Nubank sends one a month, dated on the bill…
  const oneAMonth = [
    ['2026-06-12', 1, 87.29],
    ['2026-07-02', 2, 87.23],
    ['2026-08-02', 3, 87.23],
    ['2026-09-02', 4, 87.23],
    ['2026-10-02', 5, 87.23],
  ].map(([date, number, amount]) =>
    card({
      description: 'Escolas Padre Anchieta',
      date: date as string,
      amount: amount as number,
      purchaseDate: '2026-06-12',
      installmentNumber: number as number,
      totalInstallments: 10,
    }),
  );
  // …and BTG sends them all at once, dated the day after the purchase.
  const allAtOnce = [1, 2, 3, 4, 5].map((number) =>
    card({
      accountId: 'btg',
      description: 'Escolas Padre Anchieta',
      date: number === 1 ? '2026-05-10' : '2026-05-11',
      amount: number === 1 ? 87.29 : 87.23,
      purchaseDate: '2026-05-10',
      installmentNumber: number,
      totalInstallments: 10,
    }),
  );

  it('is the month of the purchase plus (n − 1), however the bank sends them', () => {
    const [nubank] = groupInstallments(oneAMonth);
    expect(bankInstallmentIn(nubank, '2026-10')).toBe(5);
    expect(bankInstallmentIn(nubank, '2026-09')).toBe(4);
    const [btg] = groupInstallments(allAtOnce);
    // The date says May for all of them; October is still the 6th.
    expect(bankInstallmentIn(btg, '2026-10')).toBe(6);
    expect(bankInstallmentIn(btg, '2026-05')).toBe(1);
  });

  it('is none before the purchase or after the last one', () => {
    const [nubank] = groupInstallments(oneAMonth);
    expect(bankInstallmentIn(nubank, '2026-05')).toBeNull();
    expect(bankInstallmentIn(nubank, '2027-03')).toBe(10);
    expect(bankInstallmentIn(nubank, '2027-04')).toBeNull();
    // Across the turn of the year.
    expect(bankInstallmentIn({ purchaseDate: '2025-12-10', count: 10 }, '2026-01')).toBe(2);
  });

  it("in the Capital, it is the plan's own charge in the month", () => {
    const plan = { firstDebitDate: '2026-07-10', count: 10 };
    expect(planChargeIn(plan, '2026-10')).toEqual({ number: 4, dueDate: '2026-10-10' });
    expect(planChargeIn(plan, '2026-06')).toBeNull();
    expect(planChargeIn(plan, '2027-05')).toBeNull();
  });

  it('the check shows this month and the one before, across the turn of the year', () => {
    expect(reviewMonths('2026-10-21')).toEqual(['2026-09', '2026-10']);
    expect(reviewMonths('2027-01-01')).toEqual(['2026-12', '2027-01']);
  });
});

describe('the strong pair ("✓ Confere" without a tap)', () => {
  const line = (key: string, overrides: Partial<{ amount: number; date: string; onCard: boolean; cardId: string | null }> = {}) => ({
    key,
    amount: 87.96,
    date: '2026-10-12',
    onCard: false,
    cardId: null,
    ...overrides,
  });
  const entry = (id: string, overrides: Partial<{ amount: number; date: string | null; cardId: string | null }> = {}) => ({
    id,
    amount: 87.96,
    date: '2026-10-12',
    cardId: null,
    ...overrides,
  });

  it('same amount to the cent, at most a day apart, one candidate', () => {
    expect(strongPairs([line('a')], [entry('e', { date: '2026-10-13' })], new Set())).toEqual(new Map([['a', 'e']]));
    // Two days: only "Parece que você já lançou isso".
    expect(strongPairs([line('a')], [entry('e', { date: '2026-10-14' })], new Set()).size).toBe(0);
    // A cent off, an entry already tied to another bank line, or no date: no pair.
    expect(strongPairs([line('a')], [entry('e', { amount: 87.95 })], new Set()).size).toBe(0);
    expect(strongPairs([line('a')], [entry('e')], new Set(['e'])).size).toBe(0);
    expect(strongPairs([line('a')], [entry('e', { date: null })], new Set()).size).toBe(0);
  });

  it('on the same card when both say one', () => {
    const onCard = line('a', { onCard: true, cardId: 'nubank' });
    expect(strongPairs([onCard], [entry('e', { cardId: 'btg' })], new Set()).size).toBe(0);
    expect(strongPairs([onCard], [entry('e', { cardId: 'nubank' })], new Set()).get('a')).toBe('e');
    expect(strongPairs([onCard], [entry('e')], new Set()).get('a')).toBe('e');
  });

  it('never with two candidates on either side', () => {
    expect(strongPairs([line('a')], [entry('e1'), entry('e2')], new Set()).size).toBe(0);
    // Two equal coffees on the same day and one entry: neither is the pair.
    expect(strongPairs([line('a'), line('b')], [entry('e')], new Set()).size).toBe(0);
  });
});

describe('who is on the other side of a Pix', () => {
  it('money paid and received by the same CPF is the person\'s own, whatever the category says', () => {
    expect(documentKey('526.496.198-05')).toBe('52649619805');
    expect(documentKey('***123***')).toBeNull();
    const own = tx({
      type: 'CREDIT',
      amount: 186.72,
      category: 'Transfer - PIX',
      paymentMethod: 'PIX',
      payerDocument: '526.496.198-05',
      receiverDocument: '52649619805',
    });
    expect(ignoreReason(own)).toBe('own_transfer');
    expect(ignoreReason({ ...own, payerDocument: '248.795.238-52' })).toBeNull();
  });

  it('reads the name some banks put after a "|", never a code or a date', () => {
    expect(rawCounterpart('Transferência Recebida|Edilaine Carla Fracaro')).toBe('Edilaine Carla Fracaro');
    expect(rawCounterpart('Pagamento efetuado|BANCO IBI S A')).toBe('BANCO IBI S A');
    expect(rawCounterpart('15549979 - Cashback Gestão de Carteira | Apr-26')).toBeNull();
    expect(rawCounterpart('Pix')).toBeNull();
    expect(rawCounterpart(null)).toBeNull();
  });

  it('a name one bank told names the same CPF in another bank', () => {
    // As in the dev database: Nubank names the person, BTG sends only the CPF.
    const nubank = tx({
      type: 'CREDIT',
      amount: 102,
      descriptionRaw: 'Transferência Recebida|VINÍCIUS HENRIQUE RODRIGUES',
      payerDocument: '508.479.978-63',
      receiverDocument: '526.496.198-05',
    });
    const btg = tx({ type: 'CREDIT', amount: 24, payerDocument: '508.479.978-63', receiverDocument: '526.496.198-05' });
    const sent = tx({ type: 'DEBIT', amount: -29.04, payerDocument: '526.496.198-05', receiverDocument: '508.479.978-63' });
    const known = namesByDocument([nubank]);
    expect(counterpartName(btg, known)).toBe('Vinícius Henrique Rodrigues');
    expect(counterpartName(sent, known)).toBe('Vinícius Henrique Rodrigues');
    // The bank's own name comes first; with no name anywhere, nothing (a CPF is never shown).
    expect(counterpartName({ ...btg, payerName: 'WYNTECH LTDA' }, known)).toBe('Wyntech Ltda');
    expect(counterpartName({ ...btg, payerDocument: '111.222.333-44' }, known)).toBeNull();
  });

  it('calls a person by first and last name, a company by its whole name', () => {
    expect(shortName('Daniel Carlos Sousa Ferrari', '412.926.728-03')).toBe('Daniel Ferrari');
    expect(shortName('Ana Lima')).toBe('Ana Lima');
    expect(shortName('Wyntech Servicos Em Tecnologia Da Informacao Ltda', '08.911.585/0001-03')).toBe(
      'Wyntech Servicos Em Tecnologia Da Informacao Ltda',
    );
    expect(shortName('Amazon Servicos De Varejo Do Brasil Ltda.')).toBe('Amazon Servicos De Varejo Do Brasil Ltda.');
  });
});

describe('tied by hand, in full or in part', () => {
  it('confers when what is tied adds up to the line, and says what is missing otherwise', () => {
    expect(coverage([{ amount: 100 }, { amount: 100 }], 200)).toEqual({ covered: true, remaining: 0 });
    expect(coverage([{ amount: 100 }], 200)).toEqual({ covered: false, remaining: 100 });
    // A Pix of R$ 50 that pays part of an "A receber" of R$ 100 is all explained.
    expect(coverage([{ amount: 100 }], 50)).toEqual({ covered: true, remaining: 0 });
  });

  it('finds the entries that add up to a purchase, only when that is the one way', () => {
    const line = { key: 'jogos', amount: 200, date: '2026-10-20', onCard: true, cardId: 'nubank' };
    const entry = (id: string, amount: number, overrides: { date?: string; cardId?: string | null } = {}) => ({
      id,
      amount,
      date: '2026-10-20',
      cardId: 'nubank',
      ...overrides,
    });
    // R$ 200 of games, entered as two "A receber" of R$ 100.
    expect(findSplit(line, [entry('joao', 100), entry('pedro', 100), entry('cafe', 8)], new Set())?.sort()).toEqual([
      'joao',
      'pedro',
    ]);
    // Two ways to make it: nothing is suggested.
    expect(findSplit(line, [entry('a', 100), entry('b', 100), entry('c', 100)], new Set())).toBeNull();
    // Another card, two days off, or taken: not a candidate.
    expect(findSplit(line, [entry('joao', 100), entry('pedro', 100, { cardId: 'amazon' })], new Set())).toBeNull();
    expect(findSplit(line, [entry('joao', 100), entry('pedro', 100, { date: '2026-10-22' })], new Set())).toBeNull();
    expect(findSplit(line, [entry('joao', 100), entry('pedro', 100)], new Set(['pedro']))).toBeNull();
    // Up to four.
    expect(findSplit(line, [entry('a', 50), entry('b', 50), entry('c', 50), entry('d', 50)], new Set())).toHaveLength(4);
  });

  it('a Pix may pay back an "A receber" already marked as received, the strong case with no tap', () => {
    const received = (id: string, amount: number, reimbursedAt: string) => ({
      month: '2026-10',
      expense: {
        id,
        categoryKind: 'reimbursable' as const,
        description: `Jogo — ${id}`,
        amount,
        date: '2026-10-10',
        reimbursedAt,
      },
    });
    const pix = { amount: 100, payer: 'JOAO SILVA', date: '2026-10-15' };
    const found = receivedCandidates(pix, [received('João', 100, '2026-10-15T12:00:00.000Z')], new Set());
    expect(found.map((candidate) => candidate.expense.id)).toEqual(['João']);
    expect(isStrongReceived(pix, found)).toBe(true);
    // Marked three days from the Pix: still a candidate, but asked.
    const later = receivedCandidates(pix, [received('João', 100, '2026-10-18T12:00:00.000Z')], new Set());
    expect(isStrongReceived(pix, later)).toBe(false);
    // Marked a month away: not the same payback.
    expect(receivedCandidates(pix, [received('João', 100, '2026-11-20T12:00:00.000Z')], new Set())).toEqual([]);
  });
});

describe('which card', () => {
  it('says where an entry is: Pix/débito, a card not said, or a card', () => {
    expect(entryWhere({})).toBe('account');
    expect(entryWhere({ singleInstallmentCard: true })).toBe('unknownCard');
    expect(entryWhere({ singleInstallmentCard: true, cardId: 'amazon' })).toBe('otherCard');
  });

  it('a card tied to the Nubank wants the Nubank; "Não informar" any card; not tied yet, anything', () => {
    const nubank = { cardId: 'nubank' };
    expect(onExpectedCard({ singleInstallmentCard: true, cardId: 'nubank' }, nubank)).toBe(true);
    expect(onExpectedCard({ singleInstallmentCard: true, cardId: 'amazon' }, nubank)).toBe(false);
    expect(onExpectedCard({ singleInstallmentCard: true }, nubank)).toBe(false);
    expect(onExpectedCard({}, nubank)).toBe(false);
    expect(onExpectedCard({ singleInstallmentCard: true }, 'anyCard')).toBe(true);
    expect(onExpectedCard({ cardId: 'amazon', singleInstallmentCard: true }, 'anyCard')).toBe(true);
    expect(onExpectedCard({}, 'anyCard')).toBe(false);
    expect(onExpectedCard({}, 'unknown')).toBe(true);
  });

  it('finds the split purchase entered "à vista": the whole amount, bought within 3 days', () => {
    const expense = (overrides: Partial<Expense>): { month: string; expense: Expense } => ({
      month: '2026-09',
      expense: { id: 'e', categoryKind: 'topic', topicId: 't', description: 'Notebook', amount: 872.3, date: '2026-09-13', ...overrides },
    });
    const group = { total: 872.3, purchaseDate: '2026-09-14' };
    expect(findUpfront(group, [expense({})], new Set())?.expense.id).toBe('e');
    expect(findUpfront(group, [expense({ date: '2026-09-09' })], new Set())).toBeNull();
    expect(findUpfront(group, [expense({ amount: 87.23 })], new Set())).toBeNull();
    expect(findUpfront(group, [expense({ installmentId: 'p' })], new Set())).toBeNull();
    expect(findUpfront(group, [expense({})], new Set(['e']))).toBeNull();
  });
});

describe('the category it suggests', () => {
  const options: CategoryOption[] = [
    { categoryKind: 'topic', topicId: 'mercado', label: 'Mercado' },
    { categoryKind: 'topic', topicId: 'diversos', label: 'Diversos' },
    { categoryKind: 'topic', topicId: 'faculdade', label: 'Faculdade' },
    { categoryKind: 'fixedCost', label: 'Custo Fixo' },
    { categoryKind: 'unforeseen', label: 'Imprevistos' },
  ];

  it('first what the person chose before for the same description', () => {
    const memory = new Map([[memoryKey('PADARIA DO ZE'), { categoryKind: 'topic' as const, topicId: 'diversos' }]]);
    expect(suggestCategory({ description: 'Padaria do Zé', merchantName: null, category: 'Groceries' }, options, memory))
      .toMatchObject({ topicId: 'diversos' });
  });

  it("then Pluggy's category, only when the person has a category called like it", () => {
    const none = new Map();
    expect(suggestCategory({ description: 'ASSAI ATACADISTA', merchantName: null, category: 'Groceries' }, options, none))
      .toMatchObject({ topicId: 'mercado' });
    expect(suggestCategory({ description: 'CURSO X', merchantName: null, category: 'School' }, options, none))
      .toMatchObject({ topicId: 'faculdade' });
    expect(suggestCategory({ description: 'TARIFA', merchantName: null, category: 'Bank fees' }, options, none))
      .toMatchObject({ categoryKind: 'unforeseen' });
    expect(suggestCategory({ description: 'UBER *TRIP', merchantName: null, category: 'Taxi and ride-hailing' }, options, none))
      .toBeNull();
  });

  it('then the default category the person kept, by what it means', () => {
    const defaults: CategoryOption[] = [
      { categoryKind: 'topic', topicId: 't-div', label: 'Diversos' },
      { categoryKind: 'topic', topicId: 't-con', label: 'Conhecimentos' },
      { categoryKind: 'fixedCost', label: 'Custo Fixo' },
    ];
    const presets = { diversos: 't-div', conhecimentos: 't-con' };
    const none = new Map();
    const suggest = (category: string) =>
      suggestCategory({ description: 'X', merchantName: null, category }, defaults, none, presets);
    expect(suggest('Eating out')).toMatchObject({ topicId: 't-div' });
    expect(suggest('University')).toMatchObject({ topicId: 't-con' });
    expect(suggest('Video streaming')).toMatchObject({ categoryKind: 'fixedCost' });
    // Metas was renamed into something else (no preset kept): no guess for a trip.
    expect(suggest('Travel')).toBeNull();
    // The supermarket is not obvious in this model: the person chooses.
    expect(suggest('Groceries')).toBeNull();
  });

  it('a remembered category that no longer exists is not suggested', () => {
    const memory = new Map([[memoryKey('PADARIA'), { categoryKind: 'topic' as const, topicId: 'arquivada' }]]);
    expect(suggestCategory({ description: 'PADARIA', merchantName: null, category: null }, options, memory)).toBeNull();
  });
});

describe('"Parece que você já lançou isso"', () => {
  const expense = (overrides: Partial<Expense>): Expense => ({
    id: 'e1',
    categoryKind: 'topic',
    topicId: 'mercado',
    description: 'Mercado',
    amount: 87.96,
    date: '2026-10-18',
    ...overrides,
  });

  it('same amount within 2 days, on the same card when both say one, not taken already', () => {
    const launched = [{ month: '2026-10', expense: expense({}) }];
    const item = { amount: 87.96, date: '2026-10-20', onCard: false, cardId: null };
    expect(findDuplicate(item, launched, new Set())?.expense.id).toBe('e1');
    expect(findDuplicate({ ...item, date: '2026-10-21' }, launched, new Set())).toBeNull();
    expect(findDuplicate({ ...item, amount: 87.95 }, launched, new Set())).toBeNull();
    expect(findDuplicate(item, launched, new Set(['e1']))).toBeNull();
    const onCard = [{ month: '2026-10', expense: expense({ cardId: 'btg', singleInstallmentCard: true }) }];
    expect(findDuplicate({ ...item, onCard: true, cardId: 'nubank' }, onCard, new Set())).toBeNull();
    expect(findDuplicate({ ...item, onCard: true, cardId: 'btg' }, onCard, new Set())?.expense.id).toBe('e1');
    expect(findDuplicate(item, [{ month: '2026-10', expense: expense({ installmentId: 'p' }) }], new Set())).toBeNull();
  });

  it('a Pix received may be an "A receber" paid back: same amount, the payer named in it first', () => {
    const owed = (id: string, description: string, date: string, extra: Partial<Expense> = {}) => ({
      month: '2026-10',
      expense: expense({ id, categoryKind: 'reimbursable', topicId: undefined, description, amount: 50, date, ...extra }),
    });
    const pending = [
      owed('jantar-maria', 'Jantar — Maria', '2026-10-15'),
      owed('jantar-joao', 'Jantar — João', '2026-10-10'),
      owed('pago', 'Cinema — João', '2026-10-12', { reimbursedAt: '2026-10-13T12:00:00.000Z' }),
    ];
    expect(findReimbursement({ amount: 50, payer: 'JOAO SILVA' }, pending, new Set())?.expense.id).toBe('jantar-joao');
    // Nobody named: the most recent one still open.
    expect(findReimbursement({ amount: 50, payer: null }, pending, new Set())?.expense.id).toBe('jantar-maria');
    expect(findReimbursement({ amount: 56, payer: 'JOAO' }, pending, new Set())).toBeNull();
    expect(findReimbursement({ amount: 50, payer: 'JOAO' }, pending, new Set(['jantar-joao', 'jantar-maria']))).toBeNull();
  });

  it('only an "A receber" spent on the day of the Pix or before', () => {
    const owed = (id: string, date: string) => ({
      month: '2026-10',
      expense: { id, categoryKind: 'reimbursable' as const, description: 'Jantar', amount: 50, date },
    });
    const pix = { amount: 50, payer: null, date: '2026-10-10' };
    const ids = (date?: string) =>
      reimbursementCandidates({ ...pix, date }, [owed('antes', '2026-10-08'), owed('mesmo-dia', '2026-10-10'), owed('depois', '2026-10-12')], new Set()).map(
        (candidate) => candidate.expense.id,
      );
    expect(ids('2026-10-10').sort()).toEqual(['antes', 'mesmo-dia']);
  });

  it('a Pix a little off still pays an "A receber" back: 10% of it, or R$ 5 when that is more', () => {
    expect(paybackTolerance(35.67)).toBe(5);
    expect(paybackTolerance(500)).toBe(50);
    const owed = (id: string, amount: number, date = '2026-10-10', description = 'Jantar') => ({
      month: '2026-10',
      expense: expense({ id, categoryKind: 'reimbursable', topicId: undefined, description, amount, date }),
    });
    const pending = [owed('jantar', 35.67)];
    expect(findReimbursement({ amount: 36, payer: null }, pending, new Set())?.expense.id).toBe('jantar');
    expect(findReimbursement({ amount: 40.67, payer: null }, pending, new Set())?.expense.id).toBe('jantar');
    expect(findReimbursement({ amount: 30.67, payer: null }, pending, new Set())?.expense.id).toBe('jantar');
    expect(findReimbursement({ amount: 40.68, payer: null }, pending, new Set())).toBeNull();
    expect(findReimbursement({ amount: 549, payer: null }, [owed('viagem', 500)], new Set())?.expense.id).toBe('viagem');
    expect(findReimbursement({ amount: 551, payer: null }, [owed('viagem', 500)], new Set())).toBeNull();
    // Nobody recognised: the closest amount first, then the most recent.
    const near = [owed('cinema', 38, '2026-10-15'), owed('uber', 36, '2026-10-01'), owed('lanche', 36, '2026-10-05')];
    expect(reimbursementCandidates({ amount: 36, payer: null }, near, new Set()).map((c) => c.expense.id)).toEqual([
      'lanche',
      'uber',
      'cinema',
    ]);
  });

  it('learns who paid back what, like the categories of the expenses', () => {
    expect(payerKey({ payerDocument: ' ***123456** ', payerName: 'João' })).toBe('doc:***123456**');
    expect(payerKey({ payerDocument: null, payerName: 'JOÃO  da SILVA' })).toBe('name:joao silva');
    expect(payerKey({ payerDocument: null, payerName: null })).toBeNull();

    const memory = paybackMemory([
      { payer: 'doc:1', description: 'Jantar — João' },
      { payer: 'doc:1', description: 'Uber — João' },
      { payer: 'doc:2', description: 'Cinema — Maria' },
    ]);
    expect(memory.get('doc:1')).toEqual(
      new Map([
        ['jantar', 1],
        ['joao', 2],
        ['uber', 1],
      ]),
    );
    const owed = (id: string, description: string, amount: number, date: string) => ({
      month: '2026-10',
      expense: expense({ id, categoryKind: 'reimbursable', topicId: undefined, description, amount, date }),
    });
    const pending = [owed('maria', 'Pizza — Maria', 40, '2026-10-15'), owed('joao', 'Pizza — João', 42, '2026-10-10')];
    // The bank sent only the CPF: what this payer paid before points at João, even a little further off.
    expect(findReimbursement({ amount: 40, payer: null }, pending, new Set(), memory.get('doc:1'))?.expense.id).toBe(
      'joao',
    );
    expect(findReimbursement({ amount: 40, payer: null }, pending, new Set(), memory.get('doc:2'))?.expense.id).toBe(
      'maria',
    );
    expect(findReimbursement({ amount: 40, payer: null }, pending, new Set())?.expense.id).toBe('maria');
  });

  it('and for money in', () => {
    const incomes = [{ month: '2026-10', income: { id: 'i1', source: 'Salário', amount: 5000, date: '2026-10-05' } }];
    expect(findDuplicateIncome({ amount: 5000, date: '2026-10-06' }, incomes, new Set())?.income.id).toBe('i1');
    expect(findDuplicateIncome({ amount: 5000, date: '2026-10-09' }, incomes, new Set())).toBeNull();
  });
});
