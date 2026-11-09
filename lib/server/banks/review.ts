import 'server-only';
import { categoryOptions } from '@/lib/categoryText';
import {
  bankInstallmentIn,
  counterpartName,
  coverage,
  entryWhere,
  findDuplicate,
  findDuplicateIncome,
  findSplit,
  findUpfront,
  groupInstallments,
  IGNORE_LABELS,
  ignoreReason,
  installmentDay,
  isPix,
  isStrongReceived,
  matchingPlan,
  memoryKey,
  namesByDocument,
  onExpectedCard,
  paybackMemory,
  paybackTolerance,
  payerKey,
  planChargeIn,
  receivedCandidates,
  reimbursementCandidates,
  reviewKind,
  reviewMonths,
  shortName,
  strongPairs,
  suggestCategory,
  type BankReview,
  type BankReviewCounts,
  type CardExpectation,
  type CategoryChoice,
  type InstallmentGroup,
  type LaunchedExpense,
  type LinkedEntry,
  type MisplacedEntry,
  type PairEntry,
  type PaybackOption,
  type ReviewItem,
  type ReviewMatch,
  type ReviewSide,
} from '@/lib/banks';
import { nextMonth, presetOf, previousMonth, round2 } from '@/lib/budget';
import { createId } from '@/lib/budget/id';
import { isModuleOn } from '@/lib/modules';
import { addDays, daysInMonth, zonedToday } from '@/lib/reminders/time';
import type { Expense, Income, InstallmentPlan, Month, MonthData } from '@/lib/budget';
import type { PostgresBudgetRepository } from '../budgetRepository';
import { HttpError } from '../httpError';
import type { PostgresWalletRepository } from '../walletRepository';
import type { BankLink, PostgresBanksRepository, ReviewRow } from './repository';

/**
 * The month's check on the server: what the banks sent in a month, sorted into what is missing in
 * the Capital (with a suggested category and the manual entry it may duplicate), what is already
 * there, what the app leaves out (with why) and what the person ignored; and each decision, applied
 * with the same functions the forms use (`saveExpense`, `saveInstallment`, `saveIncome`), so every
 * rule of bills and months holds.
 */

interface ReviewDeps {
  banks: PostgresBanksRepository;
  repo: PostgresBudgetRepository;
  wallet: PostgresWalletRepository;
}

/** Outcomes that put a transaction in the Capital ("launching" is a launch on its way). */
const DONE = new Set(['expense', 'plan', 'income', 'linked', 'reimbursed', 'bill', 'launching']);

function isDone(outcome: string | null): boolean {
  return outcome !== null && DONE.has(outcome);
}

function lastDayOf(month: Month): string {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${String(daysInMonth(year, number)).padStart(2, '0')}`;
}

function baseItem(
  row: ReviewRow,
  transactionIds: string[],
  known: Map<string, string> = new Map(),
): Omit<ReviewItem, 'kind' | 'category' | 'installments' | 'match' | 'duplicate' | 'leftOut'> {
  const onCard = row.accountKind === 'card';
  // Who is on the other side, by name: the bank's, or one another bank told for the same CPF.
  const counterpart = onCard ? null : counterpartName(row, known);
  return {
    key: row.id,
    transactionIds,
    bankName: row.bankName,
    accountId: row.accountId,
    accountName: row.accountName,
    onCard,
    cardId: onCard ? row.capitalCardId : null,
    date: row.date,
    description: row.description,
    amount: Math.abs(row.amount),
    payer: row.type === 'CREDIT' ? (counterpart ?? row.payerName) : null,
    counterpart:
      counterpart && isPix(row)
        ? shortName(counterpart, row.type === 'CREDIT' ? row.payerDocument : row.receiverDocument)
        : null,
    reimbursement: null,
    misplaced: null,
    upfront: null,
    partial: null,
    split: null,
    received: null,
  };
}

/** An "A receber" or any expense as a line may be tied to it. */
function linkedOf({ month, expense }: LaunchedExpense): LinkedEntry {
  return { month, entryId: expense.id, description: expense.description, amount: expense.amount };
}

const emptySide = (): ReviewSide => ({ missing: [], matched: [], leftOut: [], ignored: [] });

/** Which list a line goes to. */
type Place = keyof ReviewSide;

export interface ReviewOptions {
  /** The month to check (default: this one). Only this month and the one before are accepted. */
  month?: Month;
  /** Today (tests). */
  today?: string;
}

/**
 * The month's check: what the banks sent in `month` — the account's money in and out, the card's
 * purchases and the instalment of each split purchase that falls in it — each line sorted into
 * "Falta no Capital", "✓ Confere", "Deixados de fora" or "Ignorados", money out apart from money
 * in. A card's purchase confers only on the Capital card its bank card is tied to: elsewhere it is
 * "Lançado fora do cartão", and a split purchase entered "à vista" says so. Nothing is stored here:
 * a plan that matches and a strong pair are worked out on every read. No total from the bank (bill,
 * balance, limit) is in it: each line carries only its own amount.
 */
export async function buildReview(
  { banks, repo, wallet }: ReviewDeps,
  options: ReviewOptions = {},
): Promise<BankReview> {
  const today = options.today ?? zonedToday();
  const months = reviewMonths(today);
  const month = options.month ?? months[months.length - 1];
  if (!months.includes(month)) {
    throw new HttpError(400, 'MONTH_OUT_OF_RANGE', 'A conferência vai só até o mês anterior.');
  }
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const inMonth = (date: string) => date >= first && date <= last;
  // Two days around the month as well: whether a pair is the only one must not depend on the view.
  const rows = await banks.reviewTransactions(addDays(first, -2), addDays(last, 2));

  const settings = await repo.getSettings();
  const categories = categoryOptions(settings);
  // The default categories the person kept, by what they mean (see `suggestCategory`); older
  // data has no `preset` and is known by the default's name, as everywhere else in the app.
  const presets: Record<string, string> = {};
  for (const topic of settings.topics) {
    const preset = topic.archived ? undefined : presetOf(topic)?.preset;
    if (preset) presets[preset] = topic.id;
  }
  const memory = await banks.categoryMemory();
  const plans = await wallet.listInstallments();
  const tied = await banks.tiedEntries();
  const taken = new Set(tied.keys());
  // What the person tied by hand ("Procurar nos gastos"): a line can be several entries, in part.
  const links = await banks.links();
  const linksOf = new Map<string, BankLink[]>();
  for (const link of links) {
    linksOf.set(link.transactionId, [...(linksOf.get(link.transactionId) ?? []), link]);
    taken.add(link.entryId);
  }
  /** The entries tied to some transactions, once each. */
  const linkedTo = (ids: string[]): LinkedEntry[] => {
    const seen = new Map<string, LinkedEntry>();
    for (const id of ids) {
      for (const { month: entryMonth, entryId, description, amount } of linksOf.get(id) ?? []) {
        seen.set(entryId, { month: entryMonth, entryId, description, amount });
      }
    }
    return [...seen.values()];
  };
  // The "A receber" still open, when that module is on: a Pix received may be one paid back. And
  // the ones already marked as received: the friend paid, the person marked it, and the bank tells
  // it only now.
  const reimbursableOn = isModuleOn(settings, 'reimbursable');
  const pendingBack: LaunchedExpense[] = reimbursableOn ? await repo.pendingReimbursables(today.slice(0, 7)) : [];
  const receivedBack: LaunchedExpense[] = reimbursableOn
    ? (await repo.receivedReimbursables(addDays(first, -40))).filter(({ expense }) => !tied.has(expense.id))
    : [];
  // Who paid back what before: a payer the person already confirmed is recognised.
  const paidBack =
    pendingBack.length + receivedBack.length > 0 ? paybackMemory(await banks.paybackHistory()) : new Map();
  // The names the banks told, by CPF: a Pix of one bank is named by what another one said.
  const known = namesByDocument(await banks.counterparts());
  // Without the Cartão there are no cards to put a purchase on: no line is "fora do cartão".
  const cardOn = isModuleOn(settings, 'card');
  const expectation = (row: ReviewRow): CardExpectation =>
    !cardOn || row.accountKind !== 'card' || !row.cardLinked
      ? 'unknown'
      : row.capitalCardId
        ? { cardId: row.capitalCardId }
        : 'anyCard';

  // What is in the Capital: the month and its neighbours (a pair can be a day off, across the turn
  // of the month), and the months a split purchase was bought in when it may be there "à vista".
  const loaded = new Map<Month, MonthData | undefined>();
  const launched: LaunchedExpense[] = [];
  const incomes: { month: Month; income: Income }[] = [];
  const load = async (wanted: Month) => {
    if (loaded.has(wanted)) return;
    const data = await repo.getMonth(wanted);
    loaded.set(wanted, data);
    if (!data) return;
    for (const expense of data.expenses) launched.push({ month: wanted, expense });
    for (const income of data.incomes) incomes.push({ month: wanted, income });
  };
  for (const around of [previousMonth(month), month, nextMonth(month)]) await load(around);

  /** What a decided transaction became, in its own words when the entry is at hand. */
  const decided = (row: Pick<ReviewRow, 'id' | 'outcome' | 'entryId'>): ReviewMatch => {
    const id = row.entryId;
    const own =
      (id &&
        (plans.find((plan) => plan.id === id)?.name ??
          launched.find(({ expense }) => expense.id === id)?.expense.description ??
          incomes.find(({ income }) => income.id === id)?.income.source)) ||
      null;
    // Tied by hand to some entries first (in part), then launched or accepted: all of them.
    const names = [...new Set([...linkedTo([row.id]).map((entry) => entry.description), ...(own ? [own] : [])])];
    return { kind: 'decided', outcome: row.outcome ?? '', description: names.length > 0 ? names.join(' + ') : null };
  };

  /** The line of a card purchase that is in the Capital, but not where its bank card says. */
  const misplacedOf = (
    row: ReviewRow,
    entry: { kind: 'expense'; month: Month; expense: Expense } | { kind: 'plan'; plan: InstallmentPlan },
    tied: boolean,
  ): MisplacedEntry | null => {
    const expected = expectation(row);
    const shape = entry.kind === 'expense' ? entry.expense : { cardId: entry.plan.cardId, singleInstallmentCard: true };
    if (onExpectedCard(shape, expected)) return null;
    return {
      entry: entry.kind,
      month: entry.kind === 'expense' ? entry.month : null,
      entryId: entry.kind === 'expense' ? entry.expense.id : entry.plan.id,
      description: entry.kind === 'expense' ? entry.expense.description : entry.plan.name,
      date: entry.kind === 'expense' ? entry.expense.date : (entry.plan.purchaseDate ?? entry.plan.firstDebitDate),
      where: entryWhere(shape),
      otherCardId: shape.cardId ?? null,
      cardId: typeof expected === 'object' ? expected.cardId : null,
      tied,
    };
  };

  const placed: { place: Place; item: ReviewItem }[] = [];

  // Split purchases: every instalment the bank sent, of any date, read as one purchase; the line is
  // the instalment that falls in the month.
  const splits = rows.filter((row) => reviewKind(row) === 'plan' && !ignoreReason(row));
  const missingSplits: { group: InstallmentGroup; item: ReviewItem }[] = [];
  for (const group of groupInstallments(splits)) {
    const members = group.transactions as ReviewRow[];
    const head = members[0];
    const done = members.find((member) => isDone(member.outcome));
    const expected = expectation(head);
    // The plan it is in the Capital: the one it became here, the one of its card, or — to say it
    // is on another card — any that matches.
    const plan =
      plans.find((candidate) => done?.outcome === 'plan' && candidate.id === done.entryId) ??
      matchingPlan(group, plans, head.capitalCardId) ??
      (typeof expected === 'object' ? matchingPlan(group, plans, null) : null);
    let number: number;
    let date: string;
    if (plan) {
      // In the Capital: its own count decides (the card's closing day sets the first charge).
      const charge = planChargeIn(plan, month);
      if (!charge) continue;
      number = charge.number;
      date = charge.dueDate;
    } else {
      const due = bankInstallmentIn(group, month);
      if (due === null) continue;
      number = due;
      const sent = members.find((member) => (member.installmentNumber ?? 1) === number && inMonth(member.date));
      date = sent?.date ?? installmentDay(group.purchaseDate, number);
    }
    const sent = members.find((member) => (member.installmentNumber ?? 1) === number);
    const ignoredIds = members.filter((member) => member.outcome === 'ignored').map((member) => member.id);
    const openIds = members.filter((member) => member.outcome === null).map((member) => member.id);
    const misplaced = plan ? misplacedOf(head, { kind: 'plan', plan }, done?.outcome === 'plan') : null;
    const lineAmount = sent ? Math.abs(sent.amount) : group.installmentAmount;
    const byHand = plan || done ? [] : linkedTo(members.map((member) => member.id));
    const cover = byHand.length > 0 ? coverage(byHand, lineAmount) : null;
    const place: Place = misplaced
      ? 'missing'
      : plan || done || cover?.covered
        ? 'matched'
        : cover
          ? 'missing'
          : ignoredIds.length > 0
            ? 'ignored'
            : 'missing';
    const item: ReviewItem = {
      ...baseItem(head, place === 'ignored' ? ignoredIds : place === 'missing' ? openIds : members.map((m) => m.id)),
      date,
      amount: lineAmount,
      kind: 'plan',
      category: place === 'missing' && !misplaced ? suggestCategory(head, categories, memory, presets) : null,
      partial: cover && !cover.covered ? { entries: byHand, remaining: cover.remaining } : null,
      installments: {
        count: group.count,
        numbers: group.numbers,
        installmentAmount: group.installmentAmount,
        total: group.total,
        purchaseDate: group.purchaseDate,
        number,
      },
      match: misplaced
        ? null
        : plan
          ? { kind: 'plan', planId: plan.id, description: plan.name }
          : done
            ? decided(done)
            : cover?.covered
              ? { kind: 'links', entries: byHand }
              : null,
      misplaced,
      duplicate: null,
      leftOut: null,
    };
    placed.push({ place, item });
    if (place === 'missing' && !misplaced && !cover) missingSplits.push({ group, item });
  }

  // A split purchase still missing may be in the Capital "à vista", in the month it was bought.
  for (const { group } of missingSplits) {
    for (const date of [addDays(group.purchaseDate, -3), group.purchaseDate, addDays(group.purchaseDate, 3)]) {
      await load(date.slice(0, 7));
    }
  }
  for (const { group, item } of missingSplits) {
    const upfront = findUpfront(group, launched, taken);
    if (!upfront) continue;
    taken.add(upfront.expense.id);
    item.upfront = {
      month: upfront.month,
      entryId: upfront.expense.id,
      description: upfront.expense.description,
      amount: upfront.expense.amount,
      date: upfront.expense.date,
    };
  }

  // Everything else, one line per transaction of the month.
  const singles = rows.filter((row) => !(reviewKind(row) === 'plan' && !ignoreReason(row)));
  // What still asks for a tap, a couple of days around the month too (for the pairs).
  const open = singles.filter((row) => row.outcome === null && !ignoreReason(row) && !linksOf.has(row.id));
  const openItems = new Map(open.map((row) => [row.id, baseItem(row, [row.id], known)]));
  const rowOf = new Map(singles.map((row) => [row.id, row]));

  // A Pix received that pays an "A receber" back is that first (as the payback suggestion).
  for (const row of open) {
    const base = openItems.get(row.id)!;
    if (!inMonth(row.date) || reviewKind(row) !== 'income') continue;
    const payer = payerKey(row);
    const paybacks = reimbursementCandidates(base, pendingBack, taken, payer ? paidBack.get(payer) : undefined);
    if (paybacks.length === 0) continue;
    const option = ({ month: owedMonth, expense }: LaunchedExpense): PaybackOption => ({
      month: owedMonth,
      expenseId: expense.id,
      description: expense.description,
      amount: expense.amount,
      difference: round2(base.amount - expense.amount),
    });
    // One "A receber" is offered first to one Pix at most (the others stay a tap away).
    taken.add(paybacks[0].expense.id);
    base.reimbursement = { ...option(paybacks[0]), others: paybacks.slice(1, 6).map(option) };
  }

  // Then an "A receber" already marked as received: the same amount, marked a day from the Pix,
  // the only one, confers by itself; anything looser is asked ("É sim" ties them).
  const strongReceived = new Map<string, LinkedEntry>();
  for (const row of open) {
    const base = openItems.get(row.id)!;
    if (!inMonth(row.date) || reviewKind(row) !== 'income' || base.reimbursement) continue;
    const payer = payerKey(row);
    const found = receivedCandidates(base, receivedBack, taken, payer ? paidBack.get(payer) : undefined);
    if (found.length === 0) continue;
    taken.add(found[0].expense.id);
    if (isStrongReceived(base, found)) strongReceived.set(row.id, linkedOf(found[0]));
    else base.received = linkedOf(found[0]);
  }

  // The strong pairs: "✓ Confere" with no tap. Instalment charges are the plans' business.
  const pairable = (kind: 'income' | 'expense') =>
    open
      .filter((row) => (reviewKind(row) === 'income') === (kind === 'income'))
      .map((row) => openItems.get(row.id)!)
      .filter((item) => item.reimbursement === null && item.received === null && !strongReceived.has(item.key));
  const manual = launched.filter(({ expense }) => !expense.installmentId);
  const toPair = ({ expense }: LaunchedExpense): PairEntry => ({
    id: expense.id,
    amount: expense.amount,
    date: expense.date,
    cardId: expense.cardId,
  });
  const expensePairs = strongPairs(pairable('expense'), manual.map(toPair), taken);
  // Then, for a card tied to a Capital card, the same purchase entered on another card.
  const pairedSame = new Set(expensePairs.values());
  const elsewhere = strongPairs(
    pairable('expense')
      .filter((item) => !expensePairs.has(item.key) && typeof expectation(rowOf.get(item.key)!) === 'object')
      .map((item) => ({ ...item, onCard: false })),
    manual.filter(({ expense }) => !pairedSame.has(expense.id)).map(toPair),
    taken,
  );
  for (const [key, id] of elsewhere) expensePairs.set(key, id);
  const incomePairs = strongPairs(
    pairable('income'),
    incomes.map(({ income }) => ({ id: income.id, amount: income.amount, date: income.date ?? null })),
    taken,
  );
  // A paired entry is nobody else's duplicate, and shows as taken in "Procurar nos gastos".
  const paired = new Map<string, { bankName: string; date: string; transactionId: string }>();
  for (const [key, id] of [...expensePairs, ...incomePairs, ...[...strongReceived].map(([key, entry]) => [key, entry.entryId] as const)]) {
    taken.add(id);
    const item = openItems.get(key);
    if (item) paired.set(id, { bankName: item.bankName, date: item.date, transactionId: key });
  }

  const expenseEntry = (id: string | null) => launched.find(({ expense }) => expense.id === id) ?? null;

  for (const row of singles) {
    if (!inMonth(row.date)) continue;
    const reason = ignoreReason(row);
    const kind = reviewKind(row);
    const base = openItems.get(row.id) ?? baseItem(row, [row.id], known);
    const leftOut = reason ? { reason, label: IGNORE_LABELS[reason] } : null;
    const line = { ...base, kind: kind === 'plan' ? ('expense' as const) : kind, installments: null, leftOut };
    if (isDone(row.outcome)) {
      // Launched or tied here, but on another card than the bank's: it still asks for "Pôr no…".
      const entry = row.accountKind === 'card' ? expenseEntry(row.entryId) : null;
      const misplaced = entry ? misplacedOf(row, { kind: 'expense', ...entry }, true) : null;
      placed.push({
        place: misplaced ? 'missing' : 'matched',
        item: { ...line, category: null, match: misplaced ? null : decided(row), misplaced, duplicate: null },
      });
      continue;
    }
    if (row.outcome === 'ignored') {
      placed.push({ place: 'ignored', item: { ...line, category: null, match: null, duplicate: null } });
      continue;
    }
    if (reason) {
      placed.push({ place: 'leftOut', item: { ...line, category: null, match: null, duplicate: null } });
      continue;
    }
    // Tied by hand: it confers when what it is tied to adds up to it; in part, it still asks.
    const byHand = linkedTo([row.id]);
    if (byHand.length > 0) {
      const cover = coverage(byHand, base.amount);
      placed.push({
        place: cover.covered ? 'matched' : 'missing',
        item: {
          ...line,
          category: cover.covered || kind === 'income' ? null : suggestCategory(row, categories, memory, presets),
          match: cover.covered ? { kind: 'links', entries: byHand } : null,
          partial: cover.covered ? null : { entries: byHand, remaining: cover.remaining },
          duplicate: null,
        },
      });
      continue;
    }
    const received = strongReceived.get(row.id);
    if (received) {
      placed.push({ place: 'matched', item: { ...line, category: null, match: { kind: 'received', entry: received }, duplicate: null } });
      continue;
    }
    const pairedId = kind === 'income' ? incomePairs.get(row.id) : expensePairs.get(row.id);
    if (pairedId) {
      const expense = expenseEntry(pairedId);
      const income = incomes.find((entry) => entry.income.id === pairedId);
      const misplaced = expense ? misplacedOf(row, { kind: 'expense', ...expense }, false) : null;
      if (misplaced) {
        placed.push({ place: 'missing', item: { ...line, category: null, match: null, misplaced, duplicate: null } });
        continue;
      }
      const pair: ReviewMatch = expense
        ? {
            kind: 'pair',
            month: expense.month,
            entryId: pairedId,
            description: expense.expense.description,
            date: expense.expense.date,
          }
        : {
            kind: 'pair',
            month: income!.month,
            entryId: pairedId,
            description: income!.income.source,
            date: income!.income.date ?? `${income!.month}-01`,
          };
      placed.push({ place: 'matched', item: { ...line, category: null, match: pair, duplicate: null } });
      continue;
    }
    // "Parece que você já lançou isso": up to 2 days, or more than one candidate.
    const duplicate =
      base.reimbursement !== null || base.received !== null
        ? null
        : kind === 'income'
          ? findDuplicateIncome(base, incomes, taken)
          : findDuplicate(base, launched, taken);
    // Or several entries that add up to it ("São estes 2 gastos?": two "A receber" of a R$ 200 purchase).
    const splitIds = kind === 'income' || duplicate ? null : findSplit(base, manual.map(toPair), taken);
    const split = splitIds
      ? splitIds.map((id) => linkedOf(launched.find(({ expense }) => expense.id === id)!))
      : null;
    for (const entry of split ?? []) taken.add(entry.entryId);
    placed.push({
      place: 'missing',
      item: {
        ...line,
        category: kind === 'income' ? null : suggestCategory(row, categories, memory, presets),
        match: null,
        split,
        duplicate: duplicate
          ? 'expense' in duplicate
            ? {
                month: duplicate.month,
                entryId: duplicate.expense.id,
                description: duplicate.expense.description,
                amount: duplicate.expense.amount,
                date: duplicate.expense.date,
              }
            : {
                month: duplicate.month,
                entryId: duplicate.income.id,
                description: duplicate.income.source,
                amount: duplicate.income.amount,
                date: duplicate.income.date ?? `${duplicate.month}-01`,
              }
          : null,
      },
    });
    // One manual entry is the duplicate of one bank transaction at most.
    if (duplicate) taken.add('expense' in duplicate ? duplicate.expense.id : duplicate.income.id);
  }

  placed.sort((a, b) => b.item.date.localeCompare(a.item.date) || b.item.amount - a.item.amount);
  const tiedByHand = new Map(links.map((link) => [link.entryId, { bankName: link.bankName, date: link.date, transactionId: link.transactionId }]));
  const tiedTo = (id: string) => tied.get(id) ?? tiedByHand.get(id) ?? paired.get(id) ?? null;
  const asEntry = ({ month: entryMonth, expense }: LaunchedExpense) => ({
    month: entryMonth,
    id: expense.id,
    description: expense.description,
    amount: expense.amount,
    date: expense.date,
    onCard: Boolean(expense.singleInstallmentCard || expense.cardId),
    cardId: expense.cardId ?? null,
    kind: 'expense' as const,
    reimbursable:
      expense.categoryKind === 'reimbursable' ? (expense.reimbursedAt ? ('received' as const) : ('open' as const)) : null,
    tied: tiedTo(expense.id),
  });
  // What a Pix received may be: an income of the month, or an "A receber" (open, or received).
  const owed = [...pendingBack, ...receivedBack].filter(
    (entry, index, all) => all.findIndex((other) => other.expense.id === entry.expense.id) === index,
  );
  const entries: BankReview['entries'] = {
    // Instalment charges are the plans' business: a bank line is never tied to one by hand.
    expenses: launched.filter((entry) => entry.month === month && !entry.expense.installmentId).map(asEntry),
    incomes: [
      ...incomes
        .filter((entry) => entry.month === month)
        .map(({ income }) => ({
          month,
          id: income.id,
          description: income.source,
          amount: income.amount,
          date: income.date ?? null,
          onCard: false,
          cardId: null,
          kind: 'income' as const,
          reimbursable: null,
          tied: tiedTo(income.id),
        })),
      ...owed.map(asEntry),
    ],
  };
  for (const list of [entries.expenses, entries.incomes]) {
    list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.amount - a.amount);
  }
  const review: BankReview = {
    month,
    months,
    expenses: emptySide(),
    incomes: emptySide(),
    cards: await banks.reviewCards(),
    entries,
  };
  for (const { place, item } of placed) review[item.kind === 'income' ? 'incomes' : 'expenses'][place].push(item);
  return review;
}

/** How many lines of a month still ask for a tap (by Capital card too), as the check counts them. */
export async function reviewCounts(deps: ReviewDeps, options: ReviewOptions = {}): Promise<BankReviewCounts> {
  const review = await buildReview(deps, options);
  const capitalCard = new Map(review.cards.filter((card) => card.cardId).map((card) => [card.accountId, card.cardId!]));
  const cards: BankReviewCounts['cards'] = {};
  const count = (items: ReviewItem[], key: 'missing' | 'matched') => {
    for (const item of items) {
      const cardId = capitalCard.get(item.accountId);
      if (!cardId) continue;
      cards[cardId] ??= { missing: 0, matched: 0 };
      cards[cardId][key] += 1;
    }
  };
  count(review.expenses.missing, 'missing');
  count(review.expenses.matched, 'matched');
  return {
    month: review.month,
    expenses: review.expenses.missing.length,
    incomes: review.incomes.missing.length,
    cards,
  };
}

/** One decision about one line (all its transactions together). */
export type ReviewAction =
  | { action: 'expense'; transactionIds: string[]; month: Month; expense: Expense }
  | {
      action: 'plan';
      transactionIds: string[];
      plan: InstallmentPlan;
      replaces?: { month: Month; entryId: string };
    }
  | { action: 'income'; transactionIds: string[]; month: Month; income: Income }
  | { action: 'linked'; transactionIds: string[]; month: Month; entryId: string }
  | { action: 'reimbursed'; transactionIds: string[]; month: Month; expenseId: string }
  | { action: 'ignore'; transactionIds: string[] }
  | { action: 'restore'; transactionIds: string[] }
  | { action: 'link'; transactionIds: string[]; entries: { month: Month; entryId: string }[] }
  | { action: 'unlink'; transactionIds: string[] }
  | { action: 'bill'; transactionIds: string[] }
  | {
      action: 'card';
      transactionIds: string[];
      entry: 'expense' | 'plan';
      month: Month | null;
      entryId: string;
      cardId: string | null;
    };

/**
 * Applies a decision. The transactions are taken first (a second tap, or another device, gets
 * "já está no Capital" instead of a second entry), the entry is saved by the same function the
 * form uses, and only then are they marked with what they became. A failure gives them back.
 */
export async function applyReviewAction({ banks, repo, wallet }: ReviewDeps, input: ReviewAction): Promise<void> {
  if (input.action === 'card') {
    await moveToCard({ banks, repo, wallet }, input);
    return;
  }
  if (input.action === 'link') {
    await linkEntries({ banks, repo }, input);
    return;
  }
  if (input.action === 'unlink') {
    await banks.removeLinks([...new Set(input.transactionIds)]);
    return;
  }
  if (input.action === 'restore') {
    // "Voltar para conferir": only what was ignored, back to the month's check as it was.
    if (!(await banks.restore([...new Set(input.transactionIds)]))) {
      throw new HttpError(409, 'ALREADY_REVIEWED', 'Isso já foi conferido. A lista foi atualizada.');
    }
    return;
  }
  const ids = [...new Set(input.transactionIds)];
  if (!(await banks.claim(ids))) {
    throw new HttpError(409, 'ALREADY_REVIEWED', 'Isso já foi conferido. A lista foi atualizada.');
  }
  try {
    const remember = async (choice: CategoryChoice) => {
      const description = await banks.descriptionOf(ids[0]);
      if (description) await banks.remember(memoryKey(description), choice);
    };
    switch (input.action) {
      case 'expense':
        await repo.saveExpense(input.month, { ...input.expense, source: 'import' });
        await remember(input.expense);
        await banks.settle(ids, 'expense', input.expense.id, input.month);
        break;
      case 'plan':
        if (input.replaces) {
          await wallet.replaceExpenseWithInstallment(input.replaces.month, input.replaces.entryId, input.plan);
        } else {
          await wallet.saveInstallment(input.plan);
        }
        await remember(input.plan);
        await banks.settle(ids, 'plan', input.plan.id, null);
        break;
      case 'income':
        await repo.saveIncome(input.month, input.income);
        await banks.settle(ids, 'income', input.income.id, input.month);
        break;
      case 'linked':
        await banks.settle(ids, 'linked', input.entryId, input.month);
        break;
      case 'reimbursed':
        await settlePayback({ banks, repo }, ids, input.month, input.expenseId);
        break;
      case 'ignore':
        await banks.settle(ids, 'ignored', null, null);
        break;
      case 'bill':
        await banks.settle(ids, 'bill', null, null);
        break;
    }
  } catch (err) {
    await banks.release(ids);
    throw err;
  }
}

/**
 * "Procurar nos gastos": a line still undecided is tied by hand to entries of the Capital — one or
 * several, covering it in full or in part (a R$ 200 purchase, two "A receber" of R$ 100; a Pix for
 * an "A receber" already marked as received). Nothing about the entries changes. An entry tied to
 * another bank line is refused.
 */
async function linkEntries(
  { banks, repo }: Pick<ReviewDeps, 'banks' | 'repo'>,
  input: Extract<ReviewAction, { action: 'link' }>,
): Promise<void> {
  const ids = [...new Set(input.transactionIds)];
  if (!(await banks.undecided(ids))) {
    throw new HttpError(409, 'ALREADY_REVIEWED', 'Isso já foi conferido. A lista foi atualizada.');
  }
  const months = new Map<Month, MonthData | undefined>();
  for (const { month } of input.entries) if (!months.has(month)) months.set(month, await repo.getMonth(month));
  for (const { month, entryId } of input.entries) {
    const data = months.get(month);
    const exists =
      data?.expenses.some((expense) => expense.id === entryId && !expense.installmentId) ||
      data?.incomes.some((income) => income.id === entryId);
    if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Esse lançamento não existe mais.');
  }
  const tied = await banks.tiedEntries();
  const elsewhere = (await banks.links()).filter((link) => !ids.includes(link.transactionId));
  if (input.entries.some(({ entryId }) => tied.has(entryId) || elsewhere.some((link) => link.entryId === entryId))) {
    throw new HttpError(409, 'ENTRY_TAKEN', 'Esse lançamento já está ligado a outra linha do banco.');
  }
  await banks.addLinks(ids, input.entries);
}

/**
 * "Pôr no Nubank": a card purchase that is in the Capital by Pix/débito, on a card not said or on
 * another card goes to the card its bank card is tied to, saved by the same function as the form
 * (so a closed month refuses it). A line still undecided (a pair) is then tied to that entry.
 */
async function moveToCard(
  { banks, repo, wallet }: ReviewDeps,
  input: Extract<ReviewAction, { action: 'card' }>,
): Promise<void> {
  if (input.entry === 'expense') {
    const month = input.month;
    const expense = month
      ? (await repo.getMonth(month))?.expenses.find((entry) => entry.id === input.entryId && !entry.installmentId)
      : undefined;
    if (!month || !expense) throw new HttpError(404, 'NOT_FOUND', 'Esse gasto não existe mais.');
    await repo.saveExpense(month, { ...expense, singleInstallmentCard: true, cardId: input.cardId ?? undefined });
  } else {
    const plan = (await wallet.listInstallments()).find((candidate) => candidate.id === input.entryId);
    if (!plan) throw new HttpError(404, 'NOT_FOUND', 'Essa compra parcelada não existe mais.');
    await wallet.saveInstallment({ ...plan, cardId: input.cardId ?? undefined });
  }
  const ids = [...new Set(input.transactionIds)];
  if (ids.length > 0 && (await banks.claim(ids))) {
    await banks.settle(ids, input.entry === 'plan' ? 'plan' : 'linked', input.entryId, input.entry === 'plan' ? null : input.month);
  }
}

/**
 * "Marcar como recebido": the same "Já me pagou" as the A receber screen (`setReimbursed`). A Pix a
 * little off settles it too (`paybackTolerance`): what came beyond it becomes an income, and what
 * was missing an expense in Imprevistos, on the day of the Pix — both saved first, by the forms'
 * own functions, so a closed month refuses the whole thing.
 */
async function settlePayback(
  { banks, repo }: Pick<ReviewDeps, 'banks' | 'repo'>,
  ids: string[],
  month: Month,
  expenseId: string,
): Promise<void> {
  const owed = (await repo.pendingReimbursables(month)).find(
    (pending) => pending.month === month && pending.expense.id === expenseId,
  );
  if (!owed) throw new HttpError(404, 'NOT_FOUND', 'Esse A receber não existe mais ou já foi recebido.');
  const paid = await banks.paidIn(ids);
  if (!paid) throw new HttpError(404, 'NOT_FOUND', 'Essa transação não está mais no Capital +.');
  const difference = round2(paid.amount - owed.expense.amount);
  if (Math.abs(difference) > paybackTolerance(owed.expense.amount) + 0.009) {
    throw new HttpError(400, 'TOO_FAR', 'O valor do Pix está longe demais desse A receber.');
  }
  const day = paid.date;
  const { description } = owed.expense;
  if (difference >= 0.01) {
    await repo.saveIncome(day.slice(0, 7), {
      id: createId(),
      source: `Devolução a mais: ${description}`,
      amount: difference,
      date: day,
    });
  } else if (difference <= -0.01) {
    await repo.saveExpense(day.slice(0, 7), {
      id: createId(),
      categoryKind: 'unforeseen',
      description: `Faltou na devolução: ${description}`,
      amount: -difference,
      date: day,
      source: 'import',
    });
  }
  await repo.setReimbursed(month, expenseId, new Date().toISOString());
  await banks.settle(ids, 'reimbursed', expenseId, month);
}
