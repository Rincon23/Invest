// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankReview } from '@/lib/banks';
import type { InstallmentPlan } from '@/lib/budget';
import { addDays } from '@/lib/reminders/time';
import { PostgresBanksRepository, type StoredTransaction } from '../banks/repository';
import { applyReviewAction, buildReview, reviewCounts } from '../banks/review';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresWalletRepository } from '../walletRepository';

/**
 * The month's check of Open Finance (F5, then C2). The transactions are stored as the sync stores
 * them; the check sorts the month's, and each decision goes through the same functions the forms
 * use. Today is fixed, so the turn of the month is always the same.
 */

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  // No quote is ever fetched here.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('sem rede nos testes')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const TODAY = '2026-10-21';
const day = (offset: number) => addDays(TODAY, offset);

type Deps = Parameters<typeof buildReview>[0];

/** The month's check as of TODAY (this month by default). */
function check(deps: Deps, month?: string): Promise<BankReview> {
  return buildReview(deps, { today: TODAY, month });
}


async function newPerson() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Pessoa', email: `${id}@teste.local` });
  const repo = new PostgresBudgetRepository(db, id);
  const wallet = new PostgresWalletRepository(db, id, repo);
  const banks = new PostgresBanksRepository(db, id);
  await banks.addPending('item', null);
  await banks.updateConnection('item', { status: 'ok', suggestedName: 'Nubank' });
  await banks.replaceAccounts('item', [
    { accountId: 'conta', kind: 'checking', name: 'Conta Nubank', balance: 100, currency: 'BRL' },
    { accountId: 'cartao', kind: 'card', name: 'Cartão Gold', balance: 300, currency: 'BRL' },
  ]);
  await wallet.saveCard({
    id: 'nubank',
    name: 'Nubank',
    dueDay: 10,
    dueMonth: 'next',
    notifyEnabled: false,
    notifyBeforeDays: 0,
    isDefault: true,
    order: 0,
  });
  return { id, repo, wallet, banks, deps: { banks, repo, wallet } };
}

let seq = 0;
function tx(overrides: Partial<StoredTransaction>): StoredTransaction {
  seq += 1;
  return {
    transactionId: `tx-${seq}`,
    accountId: 'conta',
    date: day(-1),
    amount: -10,
    currency: 'BRL',
    description: 'ALGO',
    descriptionRaw: null,
    type: 'DEBIT',
    status: 'POSTED',
    category: null,
    operationType: null,
    paymentMethod: null,
    payerName: null,
    payerDocument: null,
    receiverName: null,
    receiverDocument: null,
    merchantName: null,
    installmentNumber: null,
    totalInstallments: null,
    purchaseDate: null,
    billId: null,
    ...overrides,
  };
}

async function outcomeOf(transactionId: string) {
  const [row] = await db
    .select({ outcome: schema.bankTransactions.outcome, entryId: schema.bankTransactions.entryId })
    .from(schema.bankTransactions)
    .where(eq(schema.bankTransactions.transactionId, transactionId));
  return row;
}

describe("the month's check", () => {
  it('sorts what arrived: what to launch, a split purchase in one line, and what is left out', async () => {
    const { banks, deps } = await newPerson();
    const instalments = Array.from({ length: 10 }, (_, index) =>
      tx({
        transactionId: `parc-${index + 1}`,
        accountId: 'cartao',
        description: `LOJA ${index + 1}/10`,
        amount: index === 0 ? 87.29 : 87.23,
        date: day(-2),
        purchaseDate: day(-2),
        installmentNumber: index + 1,
        totalInstallments: 10,
      }),
    );
    await banks.upsertTransactions([
      tx({ transactionId: 'compra', accountId: 'cartao', amount: 45.9, description: 'IFOOD', category: 'Food delivery' }),
      tx({ transactionId: 'pix-in', amount: 50, type: 'CREDIT', paymentMethod: 'PIX', payerName: 'João' }),
      tx({ transactionId: 'fatura', amount: -1200, category: 'Credit card payment', description: 'PAGAMENTO FATURA' }),
      tx({ transactionId: 'minha', amount: -500, category: 'Same person transfer' }),
      tx({ transactionId: 'antiga', amount: -99, date: day(-30) }),
      ...instalments,
    ]);

    const review = await check(deps);
    expect(review).toMatchObject({ month: '2026-10', months: ['2026-09', '2026-10'] });
    // Money out apart from money in; newest first, and on the same day the bigger amount first.
    expect(review.expenses.missing.map((item) => [item.key, item.kind, item.amount])).toEqual([
      ['compra', 'expense', 45.9],
      ['parc-1', 'plan', 87.29],
    ]);
    expect(review.incomes.missing.map((item) => [item.key, item.kind, item.amount])).toEqual([['pix-in', 'income', 50]]);
    // The split purchase is one line, the instalment of the month, and a tap takes all of them.
    const split = review.expenses.missing.find((item) => item.kind === 'plan')!;
    expect(split.transactionIds).toHaveLength(10);
    expect(split.installments).toMatchObject({ number: 1, count: 10, total: 872.36 });
    // Left out by the app, asking for nothing.
    expect(review.expenses.leftOut.map((item) => [item.key, item.leftOut?.reason])).toEqual([
      ['fatura', 'bill_payment'],
      ['minha', 'own_transfer'],
    ]);
    // Another month's purchase is that month's: September shows it, October doesn't.
    expect(Object.values(review.expenses).flat().some((item) => item.key === 'antiga')).toBe(false);
    expect((await check(deps, '2026-09')).expenses.missing.map((item) => item.key)).toEqual(['antiga']);
    expect(await reviewCounts(deps, { today: TODAY })).toEqual({ month: '2026-10', expenses: 2, incomes: 1, cards: {} });
    expect(review.cards).toEqual([
      { accountId: 'cartao', name: 'Cartão Gold', bankName: 'Nubank', cardId: null, linked: false },
    ]);
  });

  it('launches through the same save the form uses, once, and remembers the category', async () => {
    const { repo, banks, deps } = await newPerson();
    await banks.linkCard('cartao', 'nubank');
    await banks.upsertTransactions([
      tx({ transactionId: 'mercado', accountId: 'cartao', amount: 87.96, description: 'ASSAI ATACADISTA 123', date: day(-1) }),
    ]);
    const [item] = (await check(deps)).expenses.missing;
    expect(item).toMatchObject({ onCard: true, cardId: 'nubank', category: null });

    const settings = await repo.getSettings();
    const diversos = settings.topics.find((topic) => topic.name === 'Prazeres e Confortos')!.id;
    const month = item.date.slice(0, 7);
    const expense = {
      id: randomUUID(),
      categoryKind: 'topic' as const,
      topicId: diversos,
      description: 'Mercado',
      amount: item.amount,
      date: item.date,
      singleInstallmentCard: true,
      cardId: 'nubank',
    };
    await applyReviewAction(deps, { action: 'expense', transactionIds: item.transactionIds, month, expense });

    const saved = (await repo.getMonth(month))!.expenses.find((entry) => entry.id === expense.id);
    expect(saved).toMatchObject({ amount: 87.96, cardId: 'nubank', singleInstallmentCard: true, source: 'import' });
    expect(await outcomeOf('mercado')).toEqual({ outcome: 'expense', entryId: expense.id });
    // Launched, it confers: "✓ Lançado: Mercado".
    expect((await check(deps)).expenses.matched).toEqual([
      expect.objectContaining({ key: 'mercado', match: { kind: 'decided', outcome: 'expense', description: 'Mercado' } }),
    ]);

    // A second tap (or another device) never makes a second entry.
    await expect(
      applyReviewAction(deps, { action: 'expense', transactionIds: ['mercado'], month, expense: { ...expense, id: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVIEWED' });
    expect((await repo.getMonth(month))!.expenses).toHaveLength(1);

    // The next purchase that reads the same comes with the category chosen.
    await banks.upsertTransactions([
      tx({ transactionId: 'mercado-2', accountId: 'cartao', amount: 30, description: 'ASSAI ATACADISTA 456', date: TODAY }),
    ]);
    const [next] = (await check(deps)).expenses.missing;
    expect(next.category).toMatchObject({ categoryKind: 'topic', topicId: diversos });
  });

  it('spots the entry the person already made, and "É o mesmo" ties them', async () => {
    const { repo, banks, deps } = await newPerson();
    const month = day(-2).slice(0, 7);
    const settings = await repo.getSettings();
    await repo.saveExpense(month, {
      id: 'manual',
      categoryKind: 'topic',
      topicId: settings.topics[0].id,
      description: 'Pizza',
      amount: 60,
      date: day(-2),
    });
    // Two days apart: only a weak pair, "Parece que você já lançou isso".
    await banks.upsertTransactions([tx({ transactionId: 'pizza', amount: -60, description: 'PIX PIZZARIA', date: day(0) })]);

    const [item] = (await check(deps)).expenses.missing;
    expect(item.duplicate).toMatchObject({ entryId: 'manual', description: 'Pizza', amount: 60 });
    await applyReviewAction(deps, { action: 'linked', transactionIds: ['pizza'], month, entryId: 'manual' });
    expect(await outcomeOf('pizza')).toEqual({ outcome: 'linked', entryId: 'manual' });
    expect((await repo.getMonth(month))!.expenses).toHaveLength(1);
    expect((await check(deps)).expenses.matched[0].match).toEqual({
      kind: 'decided',
      outcome: 'linked',
      description: 'Pizza',
    });
  });

  it('a strong pair confers without a tap, and nothing is stored; a weak one still asks', async () => {
    const { repo, banks, deps } = await newPerson();
    const topicId = (await repo.getSettings()).topics[0].id;
    const spent = (id: string, description: string, amount: number, date: string) =>
      repo.saveExpense(date.slice(0, 7), { id, categoryKind: 'topic', topicId, description, amount, date });
    await spent('mercado', 'Mercado', 87.96, '2026-10-12');
    await spent('cafe', 'Café', 8, '2026-10-15');
    await spent('uber-1', 'Uber', 23.5, '2026-10-16');
    await spent('uber-2', 'Uber de volta', 23.5, '2026-10-16');
    await banks.upsertTransactions([
      // The same amount to the cent, a day apart, one candidate: "✓ Confere com 'Mercado' de 12/10".
      tx({ transactionId: 'assai', amount: -87.96, description: 'ASSAI', date: '2026-10-13' }),
      // Two equal coffees and one entry: neither is sure, both ask.
      tx({ transactionId: 'cafe-1', amount: -8, description: 'CAFE', date: '2026-10-15' }),
      tx({ transactionId: 'cafe-2', amount: -8, description: 'CAFE', date: '2026-10-15' }),
      // One Uber and two entries of that amount: not sure either.
      tx({ transactionId: 'uber', amount: -23.5, description: 'UBER', date: '2026-10-16' }),
    ]);

    const review = await check(deps);
    expect(review.expenses.matched).toEqual([
      expect.objectContaining({
        key: 'assai',
        match: { kind: 'pair', month: '2026-10', entryId: 'mercado', description: 'Mercado', date: '2026-10-12' },
      }),
    ]);
    // Each still asks; the coffee entry is offered to one of the coffees only.
    expect(review.expenses.missing.map((item) => item.key).sort()).toEqual(['cafe-1', 'cafe-2', 'uber']);
    expect(review.expenses.missing.map((item) => item.duplicate?.entryId ?? null).sort()).toEqual([
      'cafe',
      null,
      'uber-1',
    ]);
    // Calculated, never stored: the transaction is still undecided.
    expect(await outcomeOf('assai')).toEqual({ outcome: null, entryId: null });
    expect(await reviewCounts(deps, { today: TODAY })).toMatchObject({ expenses: 3 });
  });

  it('"Procurar nos gastos" lists the month\'s entries, with what is already tied to a bank line', async () => {
    const { repo, banks, deps } = await newPerson();
    const topicId = (await repo.getSettings()).topics[0].id;
    const spent = (id: string, description: string, amount: number, date: string) =>
      repo.saveExpense(date.slice(0, 7), { id, categoryKind: 'topic', topicId, description, amount, date });
    await spent('pizza', 'Pizza', 60, '2026-10-10');
    await spent('padaria', 'Padaria', 23.4, '2026-10-09');
    await spent('mercado', 'Mercado', 230, '2026-10-05');
    await spent('setembro', 'Setembro', 10, '2026-09-20');
    await banks.upsertTransactions([
      // A strong pair: the pizza is taken.
      tx({ transactionId: 'pix-pizza', amount: -60, date: '2026-10-10' }),
      // Three days off: no pair, so it is tied by hand.
      tx({ transactionId: 'pix-padaria', amount: -23.4, date: '2026-10-12' }),
    ]);

    const review = await check(deps);
    expect(review.entries.expenses.map((entry) => [entry.id, entry.tied?.date ?? null])).toEqual([
      ['pizza', '2026-10-10'],
      ['padaria', null],
      ['mercado', null],
    ]);
    const [padaria] = review.expenses.missing;
    await applyReviewAction(deps, { action: 'linked', transactionIds: padaria.transactionIds, month: '2026-10', entryId: 'padaria' });
    const after = await check(deps);
    expect(after.expenses.missing).toEqual([]);
    expect(after.entries.expenses.find((entry) => entry.id === 'padaria')?.tied).toMatchObject({
      bankName: 'Nubank',
      date: '2026-10-12',
    });
  });

  it('a R$ 200 purchase entered as two "A receber" of R$ 100: suggested, tied, undone, and in part', async () => {
    const { repo, banks, deps } = await newPerson();
    await repo.saveSettings({ ...(await repo.getSettings()), modules: { expenses: true, reimbursable: true } });
    const owe = (id: string, description: string, amount: number) =>
      repo.saveExpense('2026-10', { id, categoryKind: 'reimbursable', description, amount, date: '2026-10-20' });
    await owe('joao', 'Jogo — João', 100);
    await owe('pedro', 'Jogo — Pedro', 100);
    await banks.upsertTransactions([tx({ transactionId: 'jogos', accountId: 'cartao', amount: 200, date: '2026-10-20' })]);

    const [line] = (await check(deps)).expenses.missing;
    expect(line.split?.map((entry) => entry.entryId).sort()).toEqual(['joao', 'pedro']);

    // "São estes": tied, and it confers.
    await applyReviewAction(deps, { action: 'link', transactionIds: ['jogos'], entries: line.split! });
    let review = await check(deps);
    expect(review.expenses.missing).toEqual([]);
    expect(review.expenses.matched[0].match).toMatchObject({ kind: 'links', entries: [{ amount: 100 }, { amount: 100 }] });
    expect(review.entries.expenses.filter((entry) => entry.tied?.transactionId === 'jogos')).toHaveLength(2);
    // Nothing else changed: the "A receber" are still open, the transaction undecided.
    expect((await repo.pendingReimbursables('2026-10')).map((pending) => pending.expense.id).sort()).toEqual(['joao', 'pedro']);
    expect(await outcomeOf('jogos')).toEqual({ outcome: null, entryId: null });

    // "Desfazer", then tied to one only: in part, R$ 100 still missing.
    await applyReviewAction(deps, { action: 'unlink', transactionIds: ['jogos'] });
    await applyReviewAction(deps, { action: 'link', transactionIds: ['jogos'], entries: [{ month: '2026-10', entryId: 'joao' }] });
    review = await check(deps);
    expect(review.expenses.missing[0].partial).toEqual({
      entries: [{ month: '2026-10', entryId: 'joao', description: 'Jogo — João', amount: 100 }],
      remaining: 100,
    });

    // "Lançar o resto": the rest is launched, and the line confers with both.
    const topicId = (await repo.getSettings()).topics[0].id;
    await applyReviewAction(deps, {
      action: 'expense',
      transactionIds: ['jogos'],
      month: '2026-10',
      expense: { id: 'resto', categoryKind: 'topic', topicId, description: 'Jogo meu', amount: 100, date: '2026-10-20' },
    });
    expect((await check(deps)).expenses.matched[0].match).toEqual({
      kind: 'decided',
      outcome: 'expense',
      description: 'Jogo — João + Jogo meu',
    });
  });

  it('an entry tied to one bank line is not tied to another', async () => {
    const { repo, banks, deps } = await newPerson();
    const topicId = (await repo.getSettings()).topics[0].id;
    await repo.saveExpense('2026-10', { id: 'mercado', categoryKind: 'topic', topicId, description: 'Mercado', amount: 90, date: '2026-10-03' });
    await banks.upsertTransactions([
      tx({ transactionId: 'pix-a', amount: -40, date: '2026-10-08' }),
      tx({ transactionId: 'pix-b', amount: -50, date: '2026-10-09' }),
    ]);
    await applyReviewAction(deps, { action: 'link', transactionIds: ['pix-a'], entries: [{ month: '2026-10', entryId: 'mercado' }] });
    await expect(
      applyReviewAction(deps, { action: 'link', transactionIds: ['pix-b'], entries: [{ month: '2026-10', entryId: 'mercado' }] }),
    ).rejects.toMatchObject({ code: 'ENTRY_TAKEN' });
    // An entry that is not there.
    await expect(
      applyReviewAction(deps, { action: 'link', transactionIds: ['pix-b'], entries: [{ month: '2026-10', entryId: 'nada' }] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a Pix for an "A receber" already marked as received: confers, or asks, and the list offers it', async () => {
    const { repo, banks, deps } = await newPerson();
    await repo.saveSettings({ ...(await repo.getSettings()), modules: { expenses: true, reimbursable: true } });
    const owe = (id: string, description: string, amount: number) =>
      repo.saveExpense('2026-10', { id, categoryKind: 'reimbursable', description, amount, date: '2026-10-10' });
    await owe('joao', 'Jogo — João', 100);
    await owe('pedro', 'Jogo — Pedro', 80);
    await owe('aberto', 'Cinema — Ana', 30);
    // The friends paid and the person marked it right away, before the bank told.
    await repo.setReimbursed('2026-10', 'joao', '2026-10-15T12:00:00.000Z');
    await repo.setReimbursed('2026-10', 'pedro', '2026-10-15T12:00:00.000Z');
    await banks.upsertTransactions([
      tx({ transactionId: 'pix-jogo-joao', type: 'CREDIT', amount: 100, date: '2026-10-15', paymentMethod: 'PIX' }),
      tx({ transactionId: 'pix-jogo-pedro', type: 'CREDIT', amount: 78, date: '2026-10-17', paymentMethod: 'PIX' }),
    ]);

    const review = await check(deps);
    // The same amount, marked the same day, the only one: confers with no tap.
    expect(review.incomes.matched).toEqual([
      expect.objectContaining({ key: 'pix-jogo-joao', match: { kind: 'received', entry: expect.objectContaining({ entryId: 'joao' }) } }),
    ]);
    // Two reais off and two days later: asked ("É sim" ties them).
    const [pedro] = review.incomes.missing;
    expect(pedro).toMatchObject({ key: 'pix-jogo-pedro', received: { entryId: 'pedro', amount: 80 } });
    await applyReviewAction(deps, { action: 'link', transactionIds: ['pix-jogo-pedro'], entries: [pedro.received!] });
    expect((await check(deps)).incomes.missing).toEqual([]);

    // "Procurar nas rendas" offers the "A receber", open and received.
    expect(
      review.entries.incomes.map((entry) => [entry.id, entry.kind, entry.reimbursable]).sort(),
    ).toEqual([
      ['aberto', 'expense', 'open'],
      ['joao', 'expense', 'received'],
      ['pedro', 'expense', 'received'],
    ]);
  });

  it('a pair across the turn of the month is the same in both months', async () => {
    const { repo, banks, deps } = await newPerson();
    const topicId = (await repo.getSettings()).topics[0].id;
    await repo.saveExpense('2026-10', { id: 'pizza', categoryKind: 'topic', topicId, description: 'Pizza', amount: 60, date: '2026-10-01' });
    await banks.upsertTransactions([tx({ transactionId: 'pix-30', amount: -60, date: '2026-09-30' })]);

    // The Pix of 30/09 is September's, and pairs with the pizza entered on 01/10.
    const september = await check(deps, '2026-09');
    expect(september.expenses.matched.map((item) => [item.key, item.match?.kind])).toEqual([['pix-30', 'pair']]);
    expect(Object.values((await check(deps)).expenses).flat()).toEqual([]);

    // A second Pix of 60 on 01/10 makes both unsure, whichever month is looked at.
    await banks.upsertTransactions([tx({ transactionId: 'pix-01', amount: -60, date: '2026-10-01' })]);
    expect((await check(deps, '2026-09')).expenses.matched).toEqual([]);
    expect((await check(deps)).expenses.matched).toEqual([]);
  });

  it('shows this month and the one before; older months and next month are refused', async () => {
    const { deps } = await newPerson();
    await expect(check(deps, '2026-09')).resolves.toMatchObject({ month: '2026-09' });
    await expect(check(deps, '2026-08')).rejects.toMatchObject({ code: 'MONTH_OUT_OF_RANGE' });
    await expect(check(deps, '2026-11')).rejects.toMatchObject({ code: 'MONTH_OUT_OF_RANGE' });
    // On the 1st of January, December is the month before.
    await expect(buildReview(deps, { today: '2027-01-01', month: '2026-12' })).resolves.toMatchObject({
      months: ['2026-12', '2027-01'],
    });
  });

  it('each way banks send the instalments gives the instalment of the month', async () => {
    const { banks, deps } = await newPerson();
    // As the dev database has them: one a month, dated on the bill (Nubank)…
    const nubank = [
      ['2026-06-12', 1, 87.29],
      ['2026-07-02', 2, 87.23],
      ['2026-08-02', 3, 87.23],
      ['2026-09-02', 4, 87.23],
      ['2026-10-02', 5, 87.23],
    ].map(([date, number, amount]) =>
      tx({
        transactionId: `nu-${number}`,
        accountId: 'cartao',
        description: 'Escolas Padre Anchieta',
        date: date as string,
        amount: amount as number,
        purchaseDate: '2026-06-12',
        installmentNumber: number as number,
        totalInstallments: 10,
      }),
    );
    // …or all at once, dated the day after the purchase (BTG), as far as the bank sent them.
    const btg = [1, 2, 3, 4, 5].map((number) =>
      tx({
        transactionId: `btg-${number}`,
        accountId: 'cartao',
        description: 'Unianchieta',
        date: number === 1 ? '2026-05-10' : '2026-05-11',
        amount: number === 1 ? 87.29 : 87.23,
        purchaseDate: '2026-05-10',
        installmentNumber: number,
        totalInstallments: 10,
      }),
    );
    await banks.upsertTransactions([...nubank, ...btg]);

    const line = (review: BankReview, key: string) => review.expenses.missing.find((item) => item.key === key)!;
    const october = await check(deps);
    expect(line(october, 'nu-1')).toMatchObject({ date: '2026-10-02', amount: 87.23, installments: { number: 5 } });
    // The 6th never came (the date says May for all of them): it is October's all the same.
    expect(line(october, 'btg-1')).toMatchObject({ date: '2026-10-10', amount: 87.23, installments: { number: 6 } });
    const september = await check(deps, '2026-09');
    expect(line(september, 'nu-1')).toMatchObject({ date: '2026-09-02', installments: { number: 4 } });
    expect(line(september, 'btg-1')).toMatchObject({ date: '2026-09-10', installments: { number: 5 } });
    // One line per purchase, whatever month.
    expect(october.expenses.missing).toHaveLength(2);
  });

  it('a split purchase becomes a plan, and then confers by the count of the Capital', async () => {
    const { wallet, banks, deps, repo } = await newPerson();
    await banks.linkCard('cartao', 'nubank');
    // Bought in September; the bank sends the 2nd instalment on October's bill.
    const instalment = (number: number, date: string) =>
      tx({
        transactionId: `curso-${number}`,
        accountId: 'cartao',
        description: `CURSO 0${number}/03`,
        amount: 100,
        date,
        purchaseDate: '2026-09-15',
        installmentNumber: number,
        totalInstallments: 3,
      });
    await banks.upsertTransactions([instalment(1, '2026-09-15'), instalment(2, '2026-10-02')]);
    const [item] = (await check(deps)).expenses.missing;
    expect(item.installments).toMatchObject({ number: 2, count: 3 });
    expect(item.transactionIds.sort()).toEqual(['curso-1', 'curso-2']);

    const settings = await repo.getSettings();
    const plan: InstallmentPlan = {
      id: randomUUID(),
      name: 'Curso',
      categoryKind: 'topic',
      topicId: settings.topics[0].id,
      // On this card the purchase of 15/09 is first charged on 10/10.
      firstDebitDate: '2026-10-10',
      purchaseDate: item.installments!.purchaseDate,
      count: 3,
      totalAmount: item.installments!.total,
      accounting: 'upfront',
      cardId: 'nubank',
    };
    await applyReviewAction(deps, { action: 'plan', transactionIds: item.transactionIds, plan });
    expect((await wallet.listInstallments()).map((saved) => saved.id)).toEqual([plan.id]);

    // In the Capital its first charge is October's: "✓" with the Capital's number, and nothing in
    // September, where the Capital has no charge of it.
    const october = await check(deps);
    expect(october.expenses.missing).toEqual([]);
    expect(october.expenses.matched).toEqual([
      expect.objectContaining({
        key: 'curso-1',
        date: '2026-10-10',
        installments: expect.objectContaining({ number: 1 }),
        match: { kind: 'plan', planId: plan.id, description: 'Curso' },
      }),
    ]);
    expect(Object.values((await check(deps, '2026-09')).expenses).flat()).toEqual([]);

    // The 3rd instalment arrives later, undecided: still the same purchase in the Capital.
    await banks.upsertTransactions([instalment(3, '2026-11-02')]);
    expect((await check(deps)).expenses.matched.map((line) => line.match?.kind)).toEqual(['plan']);
  });

  it('a split purchase the person entered by hand confers with it, nothing stored', async () => {
    const { wallet, banks, deps, repo } = await newPerson();
    const settings = await repo.getSettings();
    await wallet.saveInstallment({
      id: 'tv',
      name: 'TV',
      categoryKind: 'topic',
      topicId: settings.topics[0].id,
      firstDebitDate: '2026-08-10',
      purchaseDate: '2026-07-20',
      count: 10,
      totalAmount: 2000,
      accounting: 'installment',
      cardId: 'nubank',
    });
    await banks.upsertTransactions([
      tx({
        transactionId: 'tv-4',
        accountId: 'cartao',
        description: 'MAGAZINE 04/10',
        amount: 200,
        date: '2026-10-02',
        purchaseDate: '2026-07-20',
        installmentNumber: 4,
        totalInstallments: 10,
      }),
    ]);
    const [line] = (await check(deps)).expenses.matched;
    expect(line).toMatchObject({ installments: { number: 3 }, match: { kind: 'plan', planId: 'tv' } });
    expect(await outcomeOf('tv-4')).toEqual({ outcome: null, entryId: null });
  });

  it('what the person ignored goes to Ignorados, with its reason when the app had one', async () => {
    const { banks, deps } = await newPerson();
    await banks.upsertTransactions([
      tx({ transactionId: 'taxa', amount: -9.9, description: 'TARIFA' }),
      tx({ transactionId: 'fatura', amount: -500, category: 'Credit card payment' }),
    ]);
    await applyReviewAction(deps, { action: 'ignore', transactionIds: ['taxa'] });
    await applyReviewAction(deps, { action: 'ignore', transactionIds: ['fatura'] });
    const review = await check(deps);
    expect(review.expenses.ignored.map((item) => [item.key, item.leftOut?.reason ?? null])).toEqual([
      ['fatura', 'bill_payment'],
      ['taxa', null],
    ]);
    expect(review.expenses.missing).toEqual([]);
    expect(review.expenses.leftOut).toEqual([]);

    // "Voltar para conferir": back where it was, the bill payment to Deixados de fora.
    await applyReviewAction(deps, { action: 'restore', transactionIds: ['taxa'] });
    await applyReviewAction(deps, { action: 'restore', transactionIds: ['fatura'] });
    expect(await outcomeOf('taxa')).toEqual({ outcome: null, entryId: null });
    const back = await check(deps);
    expect(back.expenses.missing.map((item) => item.key)).toEqual(['taxa']);
    expect(back.expenses.leftOut.map((item) => item.key)).toEqual(['fatura']);
    expect(back.expenses.ignored).toEqual([]);
  });

  it('"Voltar para conferir" takes only what was ignored', async () => {
    const { banks, deps } = await newPerson();
    await banks.upsertTransactions([
      tx({ transactionId: 'ignorada', amount: -5 }),
      tx({ transactionId: 'aberta', amount: -6 }),
    ]);
    await applyReviewAction(deps, { action: 'ignore', transactionIds: ['ignorada'] });
    // One of them was never ignored: nothing changes.
    await expect(
      applyReviewAction(deps, { action: 'restore', transactionIds: ['ignorada', 'aberta'] }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVIEWED' });
    expect(await outcomeOf('ignorada')).toEqual({ outcome: 'ignored', entryId: null });
    await expect(applyReviewAction(deps, { action: 'restore', transactionIds: ['aberta'] })).rejects.toMatchObject({
      code: 'ALREADY_REVIEWED',
    });
  });

  it('a Pix that pays back an "A receber" is offered as such, and marking it uses the same "Já me pagou"', async () => {
    const { repo, banks, deps } = await newPerson();
    // The "A receber" module on, and an open one: dinner paid for João.
    await repo.saveSettings({ ...(await repo.getSettings()), modules: { expenses: true, reimbursable: true } });
    const month = day(-3).slice(0, 7);
    await repo.saveExpense(month, {
      id: 'jantar',
      categoryKind: 'reimbursable',
      description: 'Jantar — João',
      amount: 50,
      date: day(-3),
    });
    await banks.upsertTransactions([
      tx({ transactionId: 'pix-joao', amount: 50, type: 'CREDIT', paymentMethod: 'PIX', payerName: 'JOAO SILVA' }),
    ]);

    const [item] = (await check(deps)).incomes.missing;
    expect(item).toMatchObject({
      kind: 'income',
      reimbursement: { expenseId: 'jantar', description: 'Jantar — João', amount: 50, month },
    });

    await applyReviewAction(deps, { action: 'reimbursed', transactionIds: ['pix-joao'], month, expenseId: 'jantar' });
    expect(await outcomeOf('pix-joao')).toEqual({ outcome: 'reimbursed', entryId: 'jantar' });
    expect((await repo.pendingReimbursables(month)).map((pending) => pending.expense.id)).toEqual([]);
    // Nothing else was launched: no income, the dinner is just marked as paid back.
    expect((await repo.getMonth(month))!.incomes).toEqual([]);
    // Received, the Pix confers.
    expect((await check(deps)).incomes.matched[0].match).toMatchObject({ kind: 'decided', outcome: 'reimbursed' });
  });

  it('a Pix a little off settles an "A receber": the rest becomes income, what was missing Imprevistos', async () => {
    const { repo, banks, deps } = await newPerson();
    await repo.saveSettings({ ...(await repo.getSettings()), modules: { expenses: true, reimbursable: true } });
    const month = day(-3).slice(0, 7);
    const owe = (id: string, description: string, amount: number) =>
      repo.saveExpense(month, { id, categoryKind: 'reimbursable', description, amount, date: day(-3) });
    await owe('jantar', 'Jantar — João', 35.67);
    await owe('cinema', 'Cinema — Maria', 52.4);
    await banks.upsertTransactions([
      tx({ transactionId: 'pix-36', amount: 36, type: 'CREDIT', paymentMethod: 'PIX', payerDocument: '***111***' }),
      tx({ transactionId: 'pix-50', amount: 50, type: 'CREDIT', paymentMethod: 'PIX', payerDocument: '***222***' }),
    ]);

    const review = await check(deps);
    const byId = (id: string) => review.incomes.missing.find((item) => item.transactionIds[0] === id)!;
    expect(byId('pix-36').reimbursement).toMatchObject({ expenseId: 'jantar', difference: 0.33, others: [] });
    expect(byId('pix-50').reimbursement).toMatchObject({ expenseId: 'cinema', difference: -2.4 });

    await applyReviewAction(deps, { action: 'reimbursed', transactionIds: ['pix-36'], month, expenseId: 'jantar' });
    await applyReviewAction(deps, { action: 'reimbursed', transactionIds: ['pix-50'], month, expenseId: 'cinema' });
    expect((await repo.pendingReimbursables(month)).map((pending) => pending.expense.id)).toEqual([]);
    const pixMonth = day(-1).slice(0, 7);
    const data = (await repo.getMonth(pixMonth))!;
    expect(data.incomes).toEqual([
      expect.objectContaining({ source: 'Devolução a mais: Jantar — João', amount: 0.33, date: day(-1) }),
    ]);
    expect(data.expenses.filter((expense) => expense.categoryKind === 'unforeseen')).toEqual([
      expect.objectContaining({ description: 'Faltou na devolução: Cinema — Maria', amount: 2.4, date: day(-1) }),
    ]);

    // Next time the same CPF sends a Pix, the "A receber" that speaks of João comes first.
    await owe('uber-maria', 'Uber — Maria', 20);
    await owe('uber-joao', 'Uber — João', 21);
    await banks.upsertTransactions([
      tx({ transactionId: 'pix-20', amount: 20, type: 'CREDIT', paymentMethod: 'PIX', payerDocument: '***111***' }),
    ]);
    const [again] = (await check(deps)).incomes.missing;
    expect(again.reimbursement).toMatchObject({
      expenseId: 'uber-joao',
      difference: -1,
      others: [expect.objectContaining({ expenseId: 'uber-maria', difference: 0 })],
    });
  });

  it('a Pix says who it came from, by the name another bank told for the CPF, and finds the "A receber"', async () => {
    const { repo, banks, deps } = await newPerson();
    await repo.saveSettings({ ...(await repo.getSettings()), modules: { expenses: true, reimbursable: true } });
    const owe = (id: string, description: string, date: string) =>
      repo.saveExpense(date.slice(0, 7), { id, categoryKind: 'reimbursable', description, amount: 30, date });
    await owe('uber-ana', 'Uber — Ana', '2026-10-03');
    // Spent after the Pix: it can't be what the Pix paid back.
    await owe('cinema', 'Cinema', '2026-10-12');
    const own = { receiverDocument: '526.496.198-05' };
    await banks.upsertTransactions([
      // Last month, a bank that names the person.
      tx({
        transactionId: 'nu-ana',
        type: 'CREDIT',
        amount: 12,
        date: '2026-09-05',
        description: 'Transferência Recebida',
        descriptionRaw: 'Transferência Recebida|ANA LIMA SOUZA',
        paymentMethod: 'PIX',
        payerDocument: '248.795.238-52',
        ...own,
      }),
      // This month, a bank that sends only the CPF.
      tx({
        transactionId: 'btg-ana',
        type: 'CREDIT',
        amount: 31,
        date: '2026-10-08',
        description: 'Pix',
        paymentMethod: 'PIX',
        payerDocument: '248.795.238-52',
        ...own,
      }),
      // Money between the person's own accounts, same CPF on both sides: never asked about.
      tx({
        transactionId: 'minha',
        type: 'CREDIT',
        amount: 30,
        date: '2026-10-09',
        description: 'Pix',
        category: 'Transfer - PIX',
        paymentMethod: 'PIX',
        payerDocument: '526.496.198-05',
        ...own,
      }),
    ]);

    const review = await check(deps);
    expect(review.incomes.missing).toEqual([
      expect.objectContaining({
        key: 'btg-ana',
        counterpart: 'Ana Souza',
        payer: 'Ana Lima Souza',
        reimbursement: expect.objectContaining({ expenseId: 'uber-ana', difference: 1, others: [] }),
      }),
    ]);
    expect(review.incomes.leftOut).toEqual([
      expect.objectContaining({ key: 'minha', reimbursement: null, leftOut: expect.objectContaining({ reason: 'own_transfer' }) }),
    ]);
  });

  it('refuses an "A receber" too far from the Pix, and launches nothing', async () => {
    const { repo, banks, deps } = await newPerson();
    await repo.saveSettings({ ...(await repo.getSettings()), modules: { expenses: true, reimbursable: true } });
    const month = day(-3).slice(0, 7);
    await repo.saveExpense(month, { id: 'viagem', categoryKind: 'reimbursable', description: 'Viagem', amount: 300, date: day(-3) });
    await banks.upsertTransactions([tx({ transactionId: 'pix-10', amount: 10, type: 'CREDIT', paymentMethod: 'PIX' })]);
    await expect(
      applyReviewAction(deps, { action: 'reimbursed', transactionIds: ['pix-10'], month, expenseId: 'viagem' }),
    ).rejects.toMatchObject({ code: 'TOO_FAR' });
    expect(await outcomeOf('pix-10')).toEqual({ outcome: null, entryId: null });
    expect((await repo.pendingReimbursables(month)).map((pending) => pending.expense.id)).toEqual(['viagem']);
  });

  it('a launch that fails gives the transaction back to the list', async () => {
    const { repo, banks, deps } = await newPerson();
    await banks.upsertTransactions([tx({ transactionId: 'fechado', amount: -20, date: day(-1) })]);
    const month = day(-1).slice(0, 7);
    await repo.closeMonth(month);
    const settings = await repo.getSettings();
    await expect(
      applyReviewAction(deps, {
        action: 'expense',
        transactionIds: ['fechado'],
        month,
        expense: {
          id: randomUUID(),
          categoryKind: 'topic',
          topicId: settings.topics[0].id,
          description: 'X',
          amount: 20,
          date: day(-1),
        },
      }),
    ).rejects.toThrow();
    expect(await outcomeOf('fechado')).toEqual({ outcome: null, entryId: null });

    await applyReviewAction(deps, { action: 'ignore', transactionIds: ['fechado'] });
    expect(await outcomeOf('fechado')).toEqual({ outcome: 'ignored', entryId: null });
  });
});

describe('the cards: what the bank card has that the Capital does not', () => {
  /** A person with the Cartão on, two cards, and the bank card tied to "nubank" (or not, or "Não informar"). */
  async function withCards(link: 'nubank' | 'none' | 'unlinked' = 'nubank') {
    const person = await newPerson();
    await person.repo.saveSettings({
      ...(await person.repo.getSettings()),
      modules: { expenses: true, card: true },
    });
    await person.wallet.saveCard({
      id: 'amazon',
      name: 'Amazon',
      dueDay: 5,
      dueMonth: 'next',
      notifyEnabled: false,
      notifyBeforeDays: 0,
      isDefault: false,
      order: 1,
    });
    if (link !== 'unlinked') await person.banks.linkCard('cartao', link === 'nubank' ? 'nubank' : null);
    const topicId = (await person.repo.getSettings()).topics[0].id;
    const spent = (id: string, amount: number, date: string, card: { cardId?: string; singleInstallmentCard?: boolean } = {}) =>
      person.repo.saveExpense(date.slice(0, 7), { id, categoryKind: 'topic', topicId, description: id, amount, date, ...card });
    return { ...person, spent };
  }
  const purchase = (id: string, amount: number, date: string) =>
    tx({ transactionId: id, accountId: 'cartao', amount, description: id.toUpperCase(), date });

  it('a purchase entered by Pix/débito is "fora do cartão", and "Pôr no Nubank" moves it by the form\'s save', async () => {
    const { repo, banks, deps, spent } = await withCards();
    await spent('padaria', 23.4, '2026-10-12');
    await banks.upsertTransactions([purchase('padaria-1', 23.4, '2026-10-12')]);

    const [line] = (await check(deps)).expenses.missing;
    expect(line.misplaced).toMatchObject({
      entry: 'expense',
      month: '2026-10',
      entryId: 'padaria',
      where: 'account',
      cardId: 'nubank',
      tied: false,
    });
    expect((await reviewCounts(deps, { today: TODAY })).cards).toEqual({ nubank: { missing: 1, matched: 0 } });

    await applyReviewAction(deps, {
      action: 'card',
      transactionIds: line.transactionIds,
      entry: 'expense',
      month: '2026-10',
      entryId: 'padaria',
      cardId: 'nubank',
    });
    const saved = (await repo.getMonth('2026-10'))!.expenses.find((expense) => expense.id === 'padaria');
    expect(saved).toMatchObject({ cardId: 'nubank', singleInstallmentCard: true, amount: 23.4 });
    expect(await outcomeOf('padaria-1')).toEqual({ outcome: 'linked', entryId: 'padaria' });
    const after = await check(deps);
    expect(after.expenses.missing).toEqual([]);
    expect(after.expenses.matched.map((item) => item.key)).toEqual(['padaria-1']);
    expect((await reviewCounts(deps, { today: TODAY })).cards).toEqual({ nubank: { missing: 0, matched: 1 } });
  });

  it('a purchase on another card says which, and a closed month refuses to move it', async () => {
    const { repo, banks, deps, spent } = await withCards();
    await spent('livro', 59.9, '2026-09-20', { cardId: 'amazon', singleInstallmentCard: true });
    await banks.upsertTransactions([purchase('livro-1', 59.9, '2026-09-21')]);

    const [line] = (await check(deps, '2026-09')).expenses.missing;
    expect(line.misplaced).toMatchObject({ where: 'otherCard', otherCardId: 'amazon', cardId: 'nubank' });

    await repo.closeMonth('2026-09');
    await expect(
      applyReviewAction(deps, {
        action: 'card',
        transactionIds: line.transactionIds,
        entry: 'expense',
        month: '2026-09',
        entryId: 'livro',
        cardId: 'nubank',
      }),
    ).rejects.toThrow();
    expect((await repo.getMonth('2026-09'))!.expenses[0]).toMatchObject({ cardId: 'amazon' });
    expect(await outcomeOf('livro-1')).toEqual({ outcome: null, entryId: null });
  });

  it('on the right card it confers; a purchase with nothing alike is missing, with the card for "Lançar"', async () => {
    const { banks, deps, spent } = await withCards();
    await spent('cinema', 40, '2026-10-10', { cardId: 'nubank', singleInstallmentCard: true });
    await banks.upsertTransactions([purchase('cinema-1', 40, '2026-10-10'), purchase('nova', 12, '2026-10-11')]);
    const review = await check(deps);
    expect(review.expenses.matched.map((item) => [item.key, item.match?.kind])).toEqual([['cinema-1', 'pair']]);
    expect(review.expenses.missing).toEqual([
      expect.objectContaining({ key: 'nova', cardId: 'nubank', misplaced: null, upfront: null }),
    ]);
  });

  it('a split purchase entered "à vista" says so, and "Trocar por parcelado" puts the plan in its place', async () => {
    const { repo, wallet, banks, deps, spent } = await withCards();
    await spent('notebook', 872.3, '2026-09-13', { cardId: 'nubank', singleInstallmentCard: true });
    await banks.upsertTransactions(
      [1, 2].map((number) =>
        tx({
          transactionId: `note-${number}`,
          accountId: 'cartao',
          description: 'LOJA NOTE',
          amount: 87.23,
          date: number === 1 ? '2026-09-13' : '2026-10-02',
          purchaseDate: '2026-09-13',
          installmentNumber: number,
          totalInstallments: 10,
        }),
      ),
    );
    const [line] = (await check(deps)).expenses.missing;
    expect(line).toMatchObject({
      kind: 'plan',
      installments: { number: 2, count: 10 },
      upfront: { month: '2026-09', entryId: 'notebook', amount: 872.3, date: '2026-09-13' },
    });

    const topicId = (await repo.getSettings()).topics[0].id;
    const plan: InstallmentPlan = {
      id: 'plano-note',
      name: 'Notebook',
      categoryKind: 'topic',
      topicId,
      firstDebitDate: '2026-10-10',
      purchaseDate: '2026-09-13',
      count: 10,
      totalAmount: 872.3,
      accounting: 'upfront',
      cardId: 'nubank',
    };
    await applyReviewAction(deps, {
      action: 'plan',
      transactionIds: line.transactionIds,
      plan,
      replaces: { month: '2026-09', entryId: 'notebook' },
    });
    // The "à vista" expense left, the plan came: never both, never none.
    expect((await wallet.listInstallments()).map((saved) => saved.id)).toEqual(['plano-note']);
    const september = (await repo.getMonth('2026-09'))!.expenses;
    expect(september.some((expense) => expense.id === 'notebook')).toBe(false);
    expect((await check(deps)).expenses.matched.map((item) => item.match?.kind)).toEqual(['plan']);
  });

  it('a bank card not tied yet compares with any card, and "Não informar" confers with a card not said', async () => {
    const unlinked = await withCards('unlinked');
    await unlinked.spent('pizza', 60, '2026-10-05');
    await unlinked.banks.upsertTransactions([purchase('pizza-1', 60, '2026-10-05')]);
    const open = await check(unlinked.deps);
    expect(open.expenses.matched.map((item) => item.key)).toEqual(['pizza-1']);
    expect(open.cards).toEqual([expect.objectContaining({ accountId: 'cartao', linked: false, cardId: null })]);

    const none = await withCards('none');
    await none.spent('bar', 30, '2026-10-06', { singleInstallmentCard: true });
    await none.spent('posto', 150, '2026-10-07');
    await none.banks.upsertTransactions([purchase('bar-1', 30, '2026-10-06'), purchase('posto-1', 150, '2026-10-07')]);
    const review = await check(none.deps);
    expect(review.expenses.matched.map((item) => item.key)).toEqual(['bar-1']);
    expect(review.expenses.missing).toEqual([
      expect.objectContaining({ key: 'posto-1', misplaced: expect.objectContaining({ where: 'account', cardId: null }) }),
    ]);
    await applyReviewAction(none.deps, {
      action: 'card',
      transactionIds: ['posto-1'],
      entry: 'expense',
      month: '2026-10',
      entryId: 'posto',
      cardId: null,
    });
    const posto = (await none.repo.getMonth('2026-10'))!.expenses.find((expense) => expense.id === 'posto');
    expect(posto).toMatchObject({ singleInstallmentCard: true });
    expect(posto?.cardId).toBeUndefined();
  });

  it('no answer carries a total from the bank: bill, balance or limit', async () => {
    const { banks, deps, spent } = await withCards();
    await banks.replaceAccounts('item', [
      { accountId: 'conta', kind: 'checking', name: 'Conta Nubank', balance: 4321.09, currency: 'BRL' },
      {
        accountId: 'cartao',
        kind: 'card',
        name: 'Cartão Gold',
        balance: 1987.65,
        currency: 'BRL',
        creditLimit: 8000,
        availableCredit: 6012.35,
        dueDate: '2026-11-10',
      },
    ]);
    await spent('mercado', 87.96, '2026-10-12');
    await banks.upsertTransactions([purchase('mercado-1', 87.96, '2026-10-12'), tx({ transactionId: 'pix', amount: -20 })]);
    const answers = JSON.stringify([
      await check(deps),
      await check(deps, '2026-09'),
      await reviewCounts(deps, { today: TODAY }),
      await banks.listConnections(),
    ]);
    for (const leak of ['balance', 'creditLimit', 'availableCredit', 'dueDate', '4321.09', '1987.65', '8000', '6012.35']) {
      expect(answers).not.toContain(leak);
    }
  });
});
