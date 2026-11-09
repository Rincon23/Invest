'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCheck, ChevronDown, CreditCard, Landmark, Pencil, Search, Tag } from 'lucide-react';
import { InstallmentFormSheet } from '@/components/card/InstallmentFormSheet';
import { useCards } from '@/components/cards/CardsProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExpenseFormSheet } from '@/components/month/ExpenseFormSheet';
import { IncomeFormSheet } from '@/components/month/IncomeFormSheet';
import { MonthSwipe } from '@/components/month/MonthSwipe';
import { MonthSwitcher } from '@/components/month/MonthSwitcher';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { useSettings } from '@/components/providers/SettingsProvider';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';
import { IconTile } from '@/components/ui/IconTile';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useToast } from '@/components/ui/Toast';
import { useWallet, WalletProvider } from '@/components/wallet/WalletProvider';
import {
  entryDescription,
  reviewMonths,
  tidyName,
  type BankReview,
  type LinkedEntry,
  type MisplacedEntry,
  type PaybackOption,
  type ReviewCard,
  type ReviewEntry,
  type ReviewItem,
  type ReviewMatch,
  type ReviewSide,
} from '@/lib/banks';
import {
  formatBRL,
  formatDayMonth,
  formatMonthLabel,
  formatMonthName,
  nextChargeDate,
  specialCategoryLabel,
  type CardBill,
  type Expense,
  type Income,
  type InstallmentPlan,
  type Month,
} from '@/lib/budget';
import { foldText } from '@/lib/categoryText/text';
import { isModuleOn } from '@/lib/modules';
import { zonedToday } from '@/lib/reminders/time';
import { banksRepository, walletRepository, type BankReviewAction } from '@/lib/storage';
import { ApiRequestError } from '@/lib/storage/apiClient';
import { toStorageErrorMessage } from '@/lib/storage/errors';

/**
 * The month's check: what the banks sent in a month, beside what is in the Capital, in two tabs
 * ("Gastos" and "Recebimentos", `?tipo=`), this month or the one before (`?mes=`, ‹ › and a swipe).
 * What is missing is launched with one tap when the Capital has a category to suggest, opens the
 * very form of a purchase, a split purchase or an income otherwise (and through the pencil), and
 * can be ignored; what is already there, what the app leaves out and what was ignored wait folded
 * below. Nothing becomes an entry without a tap, and no bill leaves without "Marcar paga".
 */
export function BankReviewScreen() {
  return (
    <ModuleGate module="banks">
      <WalletProvider>
        <Review />
      </WalletProvider>
    </ModuleGate>
  );
}

/**
 * One origin of the month's lines: a Capital card, a bank card not tied to one, or a bank's
 * accounts (money out by Pix and débito, or money in).
 */
interface Block {
  key: string;
  title: string;
  detail: string | null;
  icon: 'card' | 'bank';
  /** A bank card not tied yet: the question goes at the top of its block. */
  ask: ReviewCard | null;
  /** How many bank accounts or cards are in it (a line names its own only when there are several). */
  accounts: number;
  lines: ReviewSide;
}

const emptyLines = (): ReviewSide => ({ missing: [], matched: [], leftOut: [], ignored: [] });

/** The two tabs, as the address says them. */
type Side = 'expenses' | 'incomes';
const SIDE_PARAM: Record<Side, string> = { expenses: 'gastos', incomes: 'recebimentos' };

type FormState =
  | { kind: 'expense'; item: ReviewItem; draft: Partial<Expense> }
  | {
      kind: 'plan';
      item: ReviewItem;
      draft: Partial<InstallmentPlan>;
      /** "Trocar por parcelado": the expense entered "à vista" the plan takes the place of. */
      replaces?: { month: Month; entryId: string };
    }
  | { kind: 'income'; item: ReviewItem; initial: Income };

const primaryButton =
  'bg-primary text-primary-foreground flex min-h-[44px] flex-1 items-center justify-center rounded-lg px-3 text-sm font-semibold disabled:opacity-50';
const quietButton =
  'border-border text-foreground flex min-h-[44px] items-center justify-center rounded-lg border px-3 text-sm font-medium disabled:opacity-50';

/** The bill a payment that came from the bank looks like: still open, about the same amount. */
function billPaidBy(item: ReviewItem, bills: CardBill[]): CardBill | null {
  return (
    bills
      .filter((bill) => !bill.paid && !bill.future && Math.abs(bill.total - item.amount) <= 1)
      .sort((a, b) => Math.abs(a.total - item.amount) - Math.abs(b.total - item.amount))[0] ?? null
  );
}

function Review() {
  const params = useSearchParams();
  const [months] = useState(() => reviewMonths(zonedToday()));
  const side: Side = params.get('tipo') === SIDE_PARAM.incomes ? 'incomes' : 'expenses';
  const asked = params.get('mes');
  const month: Month = asked && months.includes(asked) ? asked : months[months.length - 1];
  const { settings } = useSettings();
  const { cards } = useCards();
  const { snapshot, refresh: refreshWallet } = useWallet();
  const { showToast } = useToast();
  const [review, setReview] = useState<BankReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  /** Lines where the person said "É outro" to the duplicate the Capital pointed at. */
  const [notSame, setNotSame] = useState<Set<string>>(() => new Set());
  /** Lines where the person said the Pix is not the "A receber" the Capital pointed at. */
  const [notPayback, setNotPayback] = useState<Set<string>>(() => new Set());
  /** Strong pairs the person undid ("Não é este"): nothing is stored, they just go back to the missing. */
  const [notPair, setNotPair] = useState<Set<string>>(() => new Set());
  /** "Lançado fora do cartão" pairs the person undid, the same way. */
  const [notMisplaced, setNotMisplaced] = useState<Set<string>>(() => new Set());
  /** Split purchases the person said are not the "à vista" entry the Capital pointed at. */
  const [notUpfront, setNotUpfront] = useState<Set<string>>(() => new Set());
  /** "São estes 2 gastos?" the person said no to. */
  const [notSplit, setNotSplit] = useState<Set<string>>(() => new Set());
  /** "Já marcado como recebido" the person said no to. */
  const [notReceived, setNotReceived] = useState<Set<string>>(() => new Set());
  /** "Procurar nos gastos": the bank line being tied by hand to something entered in the month. */
  const [searching, setSearching] = useState<ReviewItem | null>(null);
  /** The Capital card a link from the Cartão asks for (`?cartao=`): its block comes into view. */
  const focusCard = params.get('cartao');

  const load = useCallback(async () => {
    try {
      setReview(await banksRepository.getReview(month));
      setError(null);
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível abrir o que chegou dos bancos.'));
    }
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loaded = review !== null;
  useEffect(() => {
    if (!loaded || !focusCard) return;
    document.getElementById(`bloco-card:${focusCard}`)?.scrollIntoView({ block: 'start' });
  }, [loaded, focusCard]);

  /** The tab and the month live in the address, replaced (the phone's back goes to the banks). */
  const go = (next: { side?: Side; month?: Month }) => {
    const nextMonth = next.month ?? month;
    const query = `?tipo=${SIDE_PARAM[next.side ?? side]}${nextMonth === months[months.length - 1] ? '' : `&mes=${nextMonth}`}`;
    window.history.replaceState(null, '', query);
  };
  const hrefOf = (other: Month) =>
    `/bancos/conferir?tipo=${SIDE_PARAM[side]}${other === months[months.length - 1] ? '' : `&mes=${other}`}`;

  const header = <PageHeader title="Conferir" backHref="/bancos" />;
  if (!settings) return header;

  // Lançamentos restricted for this account: there is nowhere to launch what came from the banks.
  if (!isModuleOn(settings, 'expenses')) return header;

  const cardOn = isModuleOn(settings, 'card');
  // Where what was missing from a payback goes (the person may have renamed it).
  const unforeseenLabel = specialCategoryLabel('unforeseen', settings.specialCategories);
  const budgetOn = isModuleOn(settings, 'budget');

  /** Sends a decision; errors go back to whoever asked (a form shows them, a tap toasts them). */
  async function send(action: BankReviewAction) {
    try {
      setReview(await banksRepository.review(action, review?.month));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'ALREADY_REVIEWED') void load();
      throw err;
    }
    if (action.action === 'plan' || action.action === 'expense' || action.action === 'card') void refreshWallet();
  }

  async function tap(item: ReviewItem, action: BankReviewAction, done: string) {
    setBusy(item.key);
    try {
      await send(action);
      showToast(done);
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível concluir.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  const incomeOf = (item: ReviewItem): Income => ({
    id: crypto.randomUUID(),
    source: item.counterpart ?? (item.payer ? tidyName(item.payer) : entryDescription(item.description)),
    // Tied in part: what is still missing.
    amount: item.partial?.remaining ?? item.amount,
    date: item.date,
  });

  const draftOf = (item: ReviewItem): Partial<Expense> => ({
    // A Pix sent is named after whom it went to, when a bank said it.
    description: item.counterpart ?? entryDescription(item.description),
    amount: item.partial?.remaining ?? item.amount,
    date: item.date,
    ...(item.category ? { categoryKind: item.category.categoryKind, topicId: item.category.topicId } : {}),
    singleInstallmentCard: item.onCard && cardOn,
    ...(item.onCard && cardOn && item.cardId ? { cardId: item.cardId } : {}),
    source: 'import',
  });

  const planOf = (item: ReviewItem): Partial<InstallmentPlan> => {
    const split = item.installments!;
    const card = cards.find((candidate) => candidate.id === item.cardId);
    return {
      name: entryDescription(item.description),
      ...(item.category ? { categoryKind: item.category.categoryKind, topicId: item.category.topicId } : {}),
      purchaseDate: split.purchaseDate,
      // The Capital's own rule for the first charge of a purchase made that day on that card.
      firstDebitDate: card ? nextChargeDate(card, split.purchaseDate) : split.purchaseDate,
      count: split.count,
      totalAmount: split.total,
      accounting: 'upfront',
      cardId: item.cardId ?? undefined,
    };
  };

  /** The form a line opens (the pencil, or "Lançar" when there is something to choose). */
  function open(item: ReviewItem) {
    if (item.kind === 'income') setForm({ kind: 'income', item, initial: incomeOf(item) });
    else if (item.kind === 'plan' && cardOn) setForm({ kind: 'plan', item, draft: planOf(item) });
    else setForm({ kind: 'expense', item, draft: draftOf(item) });
  }

  function launch(item: ReviewItem) {
    if (item.kind === 'income') {
      void tap(
        item,
        { action: 'income', transactionIds: item.transactionIds, month: item.date.slice(0, 7), income: incomeOf(item) },
        'Renda lançada.',
      );
      return;
    }
    // A split purchase is always checked in its form: how it enters the budget is the person's call.
    if (item.kind === 'plan' || !item.category) {
      open(item);
      return;
    }
    const draft = draftOf(item);
    void tap(
      item,
      {
        action: 'expense',
        transactionIds: item.transactionIds,
        month: item.date.slice(0, 7),
        expense: { ...(draft as Expense), id: crypto.randomUUID(), categoryKind: item.category.categoryKind },
      },
      `Lançado em ${item.category.label}.`,
    );
  }

  const byDate = (a: ReviewItem, b: ReviewItem) => b.date.localeCompare(a.date) || b.amount - a.amount;
  /** A strong pair the person undid goes back to what is missing, on this screen only. */
  const undone = (item: ReviewItem) =>
    (item.match?.kind === 'pair' || item.match?.kind === 'received') && notPair.has(item.key);
  const shownSide = (which: Side): ReviewSide => {
    const lists = review![which];
    return {
      missing: [...lists.missing, ...lists.matched.filter(undone)].sort(byDate),
      matched: lists.matched.filter((item) => !undone(item)),
      leftOut: lists.leftOut,
      ignored: lists.ignored,
    };
  };
  const current = review ? shownSide(side) : null;

  const bills = snapshot?.bills ?? [];
  const cardName = (id: string | null) => cards.find((card) => card.id === id)?.name ?? 'outro cartão';

  /**
   * The month in blocks, one per origin. Money out: each Capital card (with the bank cards tied to
   * it), the bank cards not tied to one (asking which they are), then each bank's account (Pix and
   * débito). Money in: one block per bank. Only counts: no sum in reais.
   */
  function blocksOf(lines: ReviewSide): Block[] {
    const bankCards = review?.cards ?? [];
    const asks = cardOn && cards.length > 0;
    const capitalOf = (bankCard: ReviewCard | undefined) =>
      cardOn && bankCard?.linked && bankCard.cardId && cards.some((card) => card.id === bankCard.cardId)
        ? bankCard.cardId
        : null;
    const all = Object.values(lines).flat();
    const banks = [...new Set(all.filter((item) => !item.onCard).map((item) => item.bankName))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    );
    const accountsOf = (bank: string) =>
      new Set(all.filter((item) => !item.onCard && item.bankName === bank).map((item) => item.accountId)).size;
    const accountBlocks: Block[] = banks.map((bank) => ({
      key: `account:${bank}`,
      title: bank,
      detail: side === 'expenses' ? 'Conta (Pix e débito)' : null,
      icon: 'bank',
      ask: null,
      accounts: accountsOf(bank),
      lines: emptyLines(),
    }));
    const blocks: Block[] =
      side === 'incomes'
        ? accountBlocks
        : [
            ...cards
              .filter((card) => bankCards.some((bankCard) => capitalOf(bankCard) === card.id))
              .map((card) => {
                const tied = bankCards.filter((bankCard) => capitalOf(bankCard) === card.id);
                return {
                  key: `card:${card.id}`,
                  title: card.name,
                  detail: tied.map((bankCard) => bankCard.name).join(' · '),
                  icon: 'card' as const,
                  ask: null,
                  accounts: tied.length,
                  lines: emptyLines(),
                };
              }),
            ...bankCards
              .filter((bankCard) => !capitalOf(bankCard))
              .map((bankCard) => ({
                key: `bank:${bankCard.accountId}`,
                title: bankCard.name,
                detail: bankCard.linked
                  ? 'Não informado no Capital +'
                  : bankCard.bankName === bankCard.name
                    ? null
                    : bankCard.bankName,
                icon: 'card' as const,
                ask: asks && !bankCard.linked ? bankCard : null,
                accounts: 1,
                lines: emptyLines(),
              })),
            ...accountBlocks,
          ];
    const blockOf = (item: ReviewItem) => {
      if (!item.onCard) return blocks.find((block) => block.key === `account:${item.bankName}`)!;
      const capital = capitalOf(bankCards.find((candidate) => candidate.accountId === item.accountId));
      return (
        blocks.find((block) => block.key === (capital ? `card:${capital}` : `bank:${item.accountId}`)) ??
        blocks[blocks.length - 1]
      );
    };
    for (const place of ['missing', 'matched', 'leftOut', 'ignored'] as const) {
      for (const item of lines[place]) blockOf(item).lines[place].push(item);
    }
    // A card not tied yet shows even with nothing in the month: without the answer, nothing can confer.
    return blocks.filter((block) => block.ask || Object.values(block.lines).some((list) => list.length > 0));
  }

  /** Which Capital card a bank card is, asked once (or "Não informar"). */
  function linkQuestion(bankCard: ReviewCard) {
    return (
      <div className="border-border bg-card mx-4 flex flex-col gap-2 rounded-2xl border p-4 shadow-sm">
        <p className="text-foreground text-sm font-semibold">Qual é este cartão no Capital +?</p>
        <div className="flex flex-wrap gap-2">
          {[...cards.map((card) => ({ id: card.id as string | null, label: card.name })), { id: null, label: 'Não informar' }].map(
            (option) => (
              <Chip
                key={option.id ?? 'none'}
                label={option.label}
                selected={false}
                onClick={() =>
                  void banksRepository
                    .linkCard(bankCard.accountId, option.id)
                    .then(load)
                    .catch((err: unknown) => showToast(toStorageErrorMessage(err, 'Não foi possível salvar.'), 'error'))
                }
              />
            ),
          )}
        </div>
      </div>
    );
  }
  const shownMonth = review?.month ?? month;
  const noun = side === 'expenses' ? ['gasto confere', 'gastos conferem'] : ['recebimento confere', 'recebimentos conferem'];

  /** One block's lines: what is missing open, the rest a tap away. */
  function lists(lines: ReviewSide, scope: string, origin: (item: ReviewItem) => string | null) {
    return (
      <>
        {lines.missing.length > 0 && (
          <ul className="flex flex-col gap-3">
            {lines.missing.map((item) => (
              <ReviewRow
                key={item.key}
                item={item}
                origin={origin(item)}
                busy={busy !== null}
                showDuplicate={item.duplicate !== null && !notSame.has(item.key)}
                showPayback={item.reimbursement !== null && !notPayback.has(item.key)}
                showMisplaced={item.misplaced !== null && !notMisplaced.has(item.key)}
                showUpfront={item.upfront !== null && !notUpfront.has(item.key)}
                cardName={cardName}
                unforeseenLabel={unforeseenLabel}
                searchLabel={item.kind === 'income' ? 'Procurar nas rendas' : 'Procurar nos gastos'}
                onSearch={() => setSearching(item)}
                showSplit={item.split !== null && !notSplit.has(item.key)}
                showReceived={item.received !== null && !notReceived.has(item.key)}
                onLink={(entries, done) =>
                  void tap(
                    item,
                    {
                      action: 'link',
                      transactionIds: item.transactionIds,
                      entries: entries.map((entry) => ({ month: entry.month, entryId: entry.entryId })),
                    },
                    done,
                  )
                }
                onNotSplit={() => setNotSplit((current) => new Set(current).add(item.key))}
                onNotReceived={() => setNotReceived((current) => new Set(current).add(item.key))}
                onUnlink={() =>
                  void tap(item, { action: 'unlink', transactionIds: item.transactionIds }, 'Desfeito: a linha voltou para conferir.')
                }
                onAcceptPartial={() =>
                  void tap(
                    item,
                    {
                      action: 'linked',
                      transactionIds: item.transactionIds,
                      month: item.partial!.entries[0].month,
                      entryId: item.partial!.entries[0].entryId,
                    },
                    'Pronto: fica assim.',
                  )
                }
                onMove={(misplaced) =>
                  void tap(
                    item,
                    {
                      action: 'card',
                      transactionIds: item.transactionIds,
                      entry: misplaced.entry,
                      month: misplaced.month,
                      entryId: misplaced.entryId,
                      cardId: misplaced.cardId,
                    },
                    misplaced.cardId ? `Pronto: agora está no ${cardName(misplaced.cardId)}.` : 'Pronto: agora está no cartão.',
                  )
                }
                onNotMisplaced={() => setNotMisplaced((current) => new Set(current).add(item.key))}
                onReplace={(upfront) =>
                  setForm({ kind: 'plan', item, draft: planOf(item), replaces: { month: upfront.month, entryId: upfront.entryId } })
                }
                onKeepUpfront={(upfront) =>
                  void tap(
                    item,
                    { action: 'linked', transactionIds: item.transactionIds, month: upfront.month, entryId: upfront.entryId },
                    'Pronto: fica à vista, ligada ao banco.',
                  )
                }
                onNotUpfront={() => setNotUpfront((current) => new Set(current).add(item.key))}
                onPayback={(option) =>
                  void tap(
                    item,
                    {
                      action: 'reimbursed',
                      transactionIds: item.transactionIds,
                      month: option.month,
                      expenseId: option.expenseId,
                    },
                    paybackDone(option, unforeseenLabel),
                  )
                }
                onNotPayback={() => setNotPayback((current) => new Set(current).add(item.key))}
                onLaunch={() => launch(item)}
                onEdit={() => open(item)}
                onIgnore={() => void tap(item, { action: 'ignore', transactionIds: item.transactionIds }, 'Ignorado.')}
                onSame={() =>
                  void tap(
                    item,
                    {
                      action: 'linked',
                      transactionIds: item.transactionIds,
                      month: item.duplicate!.month,
                      entryId: item.duplicate!.entryId,
                    },
                    'Pronto: ligado ao que você já tinha lançado.',
                  )
                }
                onNotSame={() => setNotSame((current) => new Set(current).add(item.key))}
              />
            ))}
          </ul>
        )}

        <FoldedLists
          key={scope}
          lists={[
            {
              key: 'matched',
              title: '✓ Confere',
              items: lines.matched,
              render: (item) => (
                <li key={item.key} className={foldedLine}>
                  <LineHead item={item} origin={origin(item)} />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-success min-w-0 text-xs">{matchLabel(item.match)}</span>
                    {(item.match?.kind === 'pair' || item.match?.kind === 'received') && (
                      <button
                        type="button"
                        onClick={() => setNotPair((current) => new Set(current).add(item.key))}
                        className="text-primary shrink-0 text-xs font-semibold"
                      >
                        Não é este
                      </button>
                    )}
                    {item.match?.kind === 'links' && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void tap(item, { action: 'unlink', transactionIds: item.transactionIds }, 'Desfeito: a linha voltou para conferir.')
                        }
                        className="text-primary shrink-0 text-xs font-semibold"
                      >
                        Desfazer
                      </button>
                    )}
                  </div>
                </li>
              ),
            },
            {
              key: 'left-out',
              title: 'Deixados de fora',
              items: lines.leftOut,
              render: (item) => {
                const bill = item.leftOut?.reason === 'bill_payment' && cardOn ? billPaidBy(item, bills) : null;
                return (
                  <li key={item.key} className={foldedLine}>
                    <LineHead item={item} origin={origin(item)} detail={item.leftOut?.label} />
                    {bill && (
                      <div className="bg-background flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                        <span className="text-foreground text-xs">
                          Marcar a fatura de {formatMonthLabel(bill.month)} ({bill.cardName}) como paga?
                        </span>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void (async () => {
                              setBusy(item.key);
                              try {
                                await walletRepository.payBill({ cardId: bill.cardId, month: bill.month });
                                await send({ action: 'bill', transactionIds: item.transactionIds });
                                void refreshWallet();
                                showToast(`Fatura de ${formatMonthLabel(bill.month)} paga.`);
                              } catch (err) {
                                showToast(toStorageErrorMessage(err, 'Não foi possível marcar a fatura.'), 'error');
                              } finally {
                                setBusy(null);
                              }
                            })()
                          }
                          className="text-primary shrink-0 text-xs font-semibold"
                        >
                          Marcar paga
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => open(item)}
                      className="text-primary self-start text-xs font-semibold"
                    >
                      Lançar mesmo assim
                    </button>
                  </li>
                );
              },
            },
            {
              key: 'ignored',
              title: 'Ignorados',
              items: lines.ignored,
              render: (item) => (
                <li key={item.key} className={foldedLine}>
                  <LineHead item={item} origin={origin(item)} detail={item.leftOut?.label} />
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void tap(item, { action: 'restore', transactionIds: item.transactionIds }, 'Voltou para conferir.')
                    }
                    className="text-primary self-start text-xs font-semibold"
                  >
                    Voltar para conferir
                  </button>
                </li>
              ),
            },
          ]}
        />
      </>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      {header}
      <MonthSwipe
        month={shownMonth}
        onMonth={(next) => go({ month: next })}
        min={months[0]}
        max={months[months.length - 1]}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-3 px-4">
          <MonthSwitcher month={shownMonth} href={hrefOf} min={months[0]} max={months[months.length - 1]} />
          <div role="tablist" className="bg-card border-border grid grid-cols-2 gap-1 rounded-xl border p-1">
            {(['expenses', 'incomes'] as const).map((key) => {
              const missing = review ? shownSide(key).missing.length : 0;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={side === key}
                  onClick={() => go({ side: key })}
                  className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    side === key ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'
                  }`}
                >
                  {key === 'expenses' ? 'Gastos' : 'Recebimentos'}
                  {missing > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-xs tabular-nums ${
                        side === key ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {missing}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-muted text-sm">Os bancos ao lado do que está no Capital +.</p>
        </div>

        {error && <p className="bg-danger-bg text-danger mx-4 rounded-lg px-3 py-2 text-sm">{error}</p>}
        {!review && !error && <p className="text-muted py-16 text-center">Carregando…</p>}

        {current && (
          <>
            <MonthSummary month={shownMonth} lines={current} noun={noun} />
            {blocksOf(current).map((block) => {
              const missing = block.lines.missing.length;
              const matched = block.lines.matched.length;
              return (
                <section key={block.key} id={`bloco-${block.key}`} className="flex scroll-mt-16 flex-col gap-3 pt-1">
                  <div className="mx-4 flex items-center gap-3">
                    <IconTile icon={block.icon === 'card' ? CreditCard : Landmark} tone={block.icon === 'card' ? 'purple' : 'blue'} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-semibold">{block.title}</span>
                      {block.detail && <span className="text-muted block truncate text-xs">{block.detail}</span>}
                    </span>
                    {missing > 0 ? (
                      <span className="bg-warning-bg text-warning shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                        {missing} {missing === 1 ? 'falta' : 'faltam'}
                      </span>
                    ) : (
                      matched > 0 && (
                        <span className="bg-success-bg text-success shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                          ✓ confere
                        </span>
                      )
                    )}
                  </div>
                  {block.ask && linkQuestion(block.ask)}
                  {lists(block.lines, `${side}-${block.key}`, (item) =>
                    // The block says where it came from; a line names its account or card only among several.
                    block.accounts > 1 ? item.accountName : null,
                  )}
                </section>
              );
            })}
          </>
        )}
      </MonthSwipe>

      {searching && review && (
        <SearchSheet
          item={searching}
          entries={searching.kind === 'income' ? review.entries.incomes : review.entries.expenses}
          monthName={formatMonthName(review.month).toLowerCase()}
          cardName={cardName}
          busy={busy !== null}
          onClose={() => setSearching(null)}
          onPick={(picked) => {
            const item = searching;
            setSearching(null);
            void tap(
              item,
              {
                action: 'link',
                transactionIds: item.transactionIds,
                entries: picked.map((entry) => ({ month: entry.month, entryId: entry.id })),
              },
              picked.length === 1 ? `Pronto: ligado a “${picked[0].description}”.` : `Pronto: ligado a ${picked.length} lançamentos.`,
            );
          }}
        />
      )}

      {form?.kind === 'expense' && (
        <ExpenseFormSheet
          month={(form.draft.date ?? form.item.date).slice(0, 7)}
          topics={settings.topics}
          specialCategories={settings.specialCategories}
          reimbursableEnabled={isModuleOn(settings, 'reimbursable')}
          cardEnabled={cardOn}
          draft={form.draft}
          title="Conferir gasto"
          onClose={() => setForm(null)}
          onSave={async (expense) => {
            await send({
              action: 'expense',
              transactionIds: form.item.transactionIds,
              month: expense.date.slice(0, 7),
              expense: { ...expense, source: 'import' },
            });
            showToast('Gasto lançado.');
          }}
        />
      )}

      {form?.kind === 'plan' && (
        <InstallmentFormSheet
          draft={form.draft}
          topics={settings.topics}
          specialCategories={settings.specialCategories}
          showReimbursable={isModuleOn(settings, 'reimbursable')}
          cards={cards}
          closedMonths={snapshot?.closedMonths ?? []}
          today={snapshot?.today}
          onClose={() => setForm(null)}
          onSave={async (plan) => {
            await send({ action: 'plan', transactionIds: form.item.transactionIds, plan, replaces: form.replaces });
            // In the Capital the purchase counts from its first charge, which may be a later month.
            const firstMonth = plan.firstDebitDate.slice(0, 7);
            const done = form.replaces ? 'Trocada por compra parcelada.' : 'Compra parcelada lançada.';
            showToast(
              review && firstMonth > review.month
                ? `${done} No Capital +, a 1ª parcela cai em ${formatMonthLabel(firstMonth)}.`
                : done,
            );
          }}
        />
      )}

      {form?.kind === 'income' && (
        <IncomeFormSheet
          month={form.item.date.slice(0, 7)}
          initial={form.initial}
          topics={budgetOn ? settings.topics : undefined}
          title="Conferir renda"
          onClose={() => setForm(null)}
          onSave={async (income) => {
            await send({
              action: 'income',
              transactionIds: form.item.transactionIds,
              month: (income.date ?? form.item.date).slice(0, 7),
              income,
            });
            showToast('Renda lançada.');
          }}
        />
      )}
    </div>
  );
}

const foldedLine = 'border-border bg-card mx-4 flex flex-col gap-2 rounded-xl border p-3 text-sm shadow-sm';

/**
 * The lists of a block that ask for nothing, folded: one chip each with how many lines it holds
 * ("✓ Confere 14"), and a tap opens it (one at a time).
 */
function FoldedLists({
  lists,
}: {
  lists: { key: string; title: string; items: ReviewItem[]; render: (item: ReviewItem) => ReactNode }[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = lists.filter((list) => list.items.length > 0);
  if (shown.length === 0) return null;
  const opened = shown.find((list) => list.key === open);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 px-4">
        {shown.map((list) => (
          <button
            key={list.key}
            type="button"
            onClick={() => setOpen((current) => (current === list.key ? null : list.key))}
            aria-expanded={open === list.key}
            className={`flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
              open === list.key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted'
            }`}
          >
            {list.title}
            <span className="tabular-nums">{list.items.length}</span>
            <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open === list.key ? 'rotate-180' : ''}`} />
          </button>
        ))}
      </div>
      {opened && <ul className="flex flex-col gap-2">{opened.items.map(opened.render)}</ul>}
    </div>
  );
}

/** The month at a glance: how much of what the banks sent is in the Capital (only counts). */
function MonthSummary({ month, lines, noun }: { month: Month; lines: ReviewSide; noun: string[] }) {
  const missing = lines.missing.length;
  const matched = lines.matched.length;
  const total = missing + matched;
  return (
    <section className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
      {total === 0 ? (
        <p className="text-muted text-sm">Nada para conferir em {formatMonthName(month).toLowerCase()}.</p>
      ) : missing === 0 ? (
        <div className="flex items-center gap-3">
          <IconTile icon={CheckCheck} tone="green" />
          <div className="min-w-0">
            <p className="text-success font-semibold">{formatMonthName(month)} confere ✓</p>
            <p className="text-muted text-sm">
              {matched} {matched === 1 ? noun[0] : noun[1]} com o Capital +.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-foreground font-semibold">
              {missing} {missing === 1 ? 'falta' : 'faltam'} no Capital +
            </p>
            <p className="text-muted shrink-0 text-sm tabular-nums">
              {matched} de {total} conferem
            </p>
          </div>
          <ProgressBar usedPct={matched / total} state="ok" />
        </>
      )}
    </section>
  );
}

/**
 * "Procurar nos gastos": what the person entered in the month (for money in, the incomes and the
 * "A receber", open or already received), to tie the bank line to by hand when the Capital found no
 * pair. One or more, in full or in part: a R$ 200 purchase can be two "A receber" of R$ 100. What
 * is already tied to another bank line shows faded, without a tap.
 */
function SearchSheet({
  item,
  entries,
  monthName,
  cardName,
  busy,
  onClose,
  onPick,
}: {
  item: ReviewItem;
  entries: ReviewEntry[];
  monthName: string;
  cardName: (id: string | null) => string;
  busy: boolean;
  onClose: () => void;
  onPick: (entries: ReviewEntry[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const income = item.kind === 'income';
  const chosen = entries.filter((entry) => picked.includes(entry.id));
  const total = chosen.reduce((sum, entry) => sum + entry.amount, 0);
  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  /** Already tied to this very line (in part): shown, not offered again. */
  const ownLine = (entry: ReviewEntry) => entry.tied?.transactionId !== undefined && item.transactionIds.includes(entry.tied.transactionId);
  const wanted = foldText(query.trim());
  const shown = wanted
    ? entries.filter(
        (entry) =>
          foldText(entry.description).includes(wanted) ||
          formatBRL(entry.amount).replace(/\s/g, ' ').includes(query.trim()),
      )
    : entries;
  const where = (entry: ReviewEntry) =>
    entry.reimbursable === 'open'
      ? 'A receber'
      : entry.reimbursable === 'received'
        ? 'A receber · recebido'
        : income
          ? null
          : entry.onCard
            ? entry.cardId
              ? cardName(entry.cardId)
              : 'cartão não informado'
            : 'Pix/débito';
  return (
    <BottomSheet
      open
      title={income ? 'Procurar nas rendas' : 'Procurar nos gastos'}
      onClose={onClose}
      confirmDiscard={false}
    >
      <div className="flex flex-col gap-3">
        <div className="bg-background flex items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="text-muted block text-xs">Do banco · {formatDayMonth(item.date)}</span>
            <span className="text-foreground block truncate font-medium">{lineTitle(item)}</span>
          </span>
          <span className={`shrink-0 font-semibold tabular-nums ${income ? 'text-success' : 'text-foreground'}`}>
            {formatBRL(item.amount)}
          </span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar pela descrição ou valor"
          className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-full rounded-lg border px-3 text-base outline-none focus:ring-2"
        />
        {entries.length === 0 ? (
          <p className="text-muted py-6 text-center text-sm">
            {income ? 'Nenhuma renda lançada' : 'Nenhum gasto lançado'} em {monthName}.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-muted py-6 text-center text-sm">Nada com “{query.trim()}”.</p>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {shown.map((entry) => {
              const same = Math.abs(entry.amount - item.amount) < 0.005;
              const detail = [entry.date ? formatDayMonth(entry.date) : 'sem data', where(entry)]
                .filter(Boolean)
                .join(' · ');
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate">{entry.description}</span>
                    <span className="text-muted block truncate text-xs">
                      {entry.tied
                        ? ownLine(entry)
                          ? `${detail} · ligado a esta linha`
                          : `${detail} · ligado ao ${entry.tied.bankName} de ${formatDayMonth(entry.tied.date)}`
                        : detail}
                    </span>
                  </span>
                  {same && !entry.tied && (
                    <span className="bg-success-bg text-success shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                      mesmo valor
                    </span>
                  )}
                  <span className="text-foreground shrink-0 tabular-nums">{formatBRL(entry.amount)}</span>
                </>
              );
              return (
                <li key={entry.id}>
                  {entry.tied ? (
                    <div className="flex min-h-[52px] items-center gap-3 py-2 text-sm opacity-45" aria-disabled>
                      {body}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(entry.id)}
                      aria-pressed={picked.includes(entry.id)}
                      className={`flex min-h-[52px] w-full items-center gap-3 rounded-lg py-2 text-left text-sm disabled:opacity-50 ${
                        picked.includes(entry.id) ? 'bg-primary/10 -mx-2 px-2' : 'hover:bg-background'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold ${
                          picked.includes(entry.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                        }`}
                      >
                        {picked.includes(entry.id) ? '✓' : ''}
                      </span>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-muted text-xs">
          Marque um ou mais. Pode ser só uma parte.
        </p>
        <div className="bg-card border-border sticky bottom-0 -mx-4 flex flex-col gap-1 border-t px-4 pt-3 pb-1">
          {chosen.length > 0 && (
            <p className="text-muted text-center text-xs tabular-nums">
              {formatBRL(total)} de {formatBRL(item.amount)}
              {total < item.amount - 0.005 ? ` · faltam ${formatBRL(item.amount - total)}` : ''}
            </p>
          )}
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => onPick(chosen)}
            className="bg-primary text-primary-foreground flex min-h-[44px] items-center justify-center rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
          >
            {chosen.length <= 1 ? 'Ligar' : `Ligar os ${chosen.length}`}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

/** What a line is: a Pix says who it came from or went to ("Pix de Ana Lima"), when a bank said it. */
function lineTitle(item: ReviewItem): string {
  if (!item.counterpart) return entryDescription(item.description);
  return `${item.kind === 'income' ? 'Pix de' : 'Pix para'} ${item.counterpart}`;
}

/** What a folded line shows: what it is, from where and when, and how much. */
function LineHead({ item, origin, detail }: { item: ReviewItem; origin: string | null; detail?: string }) {
  const income = item.kind === 'income';
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="text-foreground block truncate">{lineTitle(item)}</span>
        <span className="text-muted block text-xs">
          {[origin, formatDayMonth(item.date)].filter(Boolean).join(' · ')}
          {item.installments && ` · parcela ${item.installments.number}/${item.installments.count}`}
          {detail && ` · ${detail}`}
        </span>
      </span>
      <span className={`shrink-0 tabular-nums ${income ? 'text-success' : 'text-foreground'}`}>
        {income ? '+' : ''}
        {formatBRL(item.amount)}
      </span>
    </div>
  );
}

const DECIDED_LABELS: Record<string, string> = {
  expense: 'Lançado',
  plan: 'Lançado como compra parcelada',
  income: 'Lançado como renda',
  linked: 'Ligado ao que você lançou',
  reimbursed: 'Devolução de um A receber',
  bill: 'Fatura marcada como paga',
  launching: 'Lançando…',
};

/** "“Jogo — João” e “Jogo — Pedro”". */
function namesOf(entries: LinkedEntry[]): string {
  const names = entries.map((entry) => `“${entry.description}”`);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** How a line is in the Capital, said in one line. */
function matchLabel(match: ReviewMatch | null): string {
  if (!match) return '✓ Confere';
  if (match.kind === 'pair') return `✓ Confere com “${match.description}” de ${formatDayMonth(match.date)}`;
  if (match.kind === 'links') return `✓ Ligado a ${namesOf(match.entries)}`;
  if (match.kind === 'received') return `✓ Devolução de “${match.entry.description}”, já recebida`;
  if (match.kind === 'plan') return `✓ Compra parcelada “${match.description}” no Capital +`;
  const label = DECIDED_LABELS[match.outcome] ?? 'Conferido';
  return match.description ? `✓ ${label}: “${match.description}”` : `✓ ${label}`;
}

/** What "Marcar como recebido" did, said back. */
function paybackDone(option: PaybackOption, unforeseenLabel: string): string {
  const what = `“${option.description}”`;
  if (option.difference >= 0.01) {
    return `Pronto: ${what} recebido, e ${formatBRL(option.difference)} a mais entraram como renda.`;
  }
  if (option.difference <= -0.01) {
    return `Pronto: ${what} recebido, e ${formatBRL(-option.difference)} que faltaram foram para ${unforeseenLabel}.`;
  }
  return `Pronto: ${what} marcado como recebido.`;
}

/** Under "É a devolução de…?": what happens to a Pix a little off. */
function differenceLine(option: PaybackOption, unforeseenLabel: string): string | null {
  if (option.difference >= 0.01) return `Os ${formatBRL(option.difference)} a mais entram como renda.`;
  if (option.difference <= -0.01) {
    return `Os ${formatBRL(-option.difference)} que faltaram entram como gasto em ${unforeseenLabel}.`;
  }
  return null;
}

/** Where a purchase that is not on its card is, in the Capital's words. */
function whereLabel(misplaced: MisplacedEntry, cardName: (id: string | null) => string): string {
  if (misplaced.where === 'account') return 'como Pix/débito';
  if (misplaced.where === 'unknownCard') return 'como cartão não informado';
  return `no ${cardName(misplaced.otherCardId)}`;
}

function ReviewRow({
  item,
  origin,
  busy,
  showDuplicate,
  showPayback,
  showMisplaced,
  showUpfront,
  cardName,
  unforeseenLabel,
  searchLabel,
  onSearch,
  showSplit,
  showReceived,
  onLink,
  onNotSplit,
  onNotReceived,
  onUnlink,
  onAcceptPartial,
  onMove,
  onNotMisplaced,
  onReplace,
  onKeepUpfront,
  onNotUpfront,
  onPayback,
  onNotPayback,
  onLaunch,
  onEdit,
  onIgnore,
  onSame,
  onNotSame,
}: {
  item: ReviewItem;
  /** Where it came from, when the block above doesn't say it already. */
  origin: string | null;
  busy: boolean;
  showDuplicate: boolean;
  showPayback: boolean;
  showMisplaced: boolean;
  showUpfront: boolean;
  cardName: (id: string | null) => string;
  unforeseenLabel: string;
  /** "Procurar nos gastos" (or "nas rendas"): tie it by hand to something entered in the month. */
  searchLabel: string;
  onSearch: () => void;
  showSplit: boolean;
  showReceived: boolean;
  /** Ties the line to these entries (a split, an "A receber" already received). */
  onLink: (entries: LinkedEntry[], done: string) => void;
  onNotSplit: () => void;
  onNotReceived: () => void;
  /** "Desfazer": the ties by hand go away. */
  onUnlink: () => void;
  /** "Está certo assim": tied in part, and that is how it stays. */
  onAcceptPartial: () => void;
  onMove: (misplaced: MisplacedEntry) => void;
  onNotMisplaced: () => void;
  onReplace: (upfront: NonNullable<ReviewItem['upfront']>) => void;
  onKeepUpfront: (upfront: NonNullable<ReviewItem['upfront']>) => void;
  onNotUpfront: () => void;
  onPayback: (option: PaybackOption) => void;
  onNotPayback: () => void;
  onLaunch: () => void;
  onEdit: () => void;
  onIgnore: () => void;
  onSame: () => void;
  onNotSame: () => void;
}) {
  const income = item.kind === 'income';
  /** "É outro A receber": the other open ones close enough in value. */
  const [otherPaybacks, setOtherPaybacks] = useState(false);
  const launchLabel = income
    ? 'Lançar renda'
    : item.kind === 'plan'
      ? 'Conferir parcelado'
      : item.category
        ? 'Lançar'
        : 'Escolher categoria';
  return (
    <li className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground truncate font-semibold">{lineTitle(item)}</p>
          <p className="text-muted truncate text-xs">
            {[origin, formatDayMonth(item.date)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <p className={`shrink-0 font-semibold tabular-nums ${income ? 'text-success' : 'text-foreground'}`}>
          {income ? '+' : ''}
          {formatBRL(item.amount)}
        </p>
      </div>

      {item.installments && (
        <p className="text-muted text-xs">
          Parcela {item.installments.number} de {item.installments.count} · total{' '}
          {formatBRL(item.installments.total)} · comprada em {formatDayMonth(item.installments.purchaseDate)}
        </p>
      )}
      {!income && !(showMisplaced && item.misplaced) && (
        <span
          className={`border-border flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-xs font-medium ${
            item.category ? 'text-foreground' : 'text-muted'
          }`}
        >
          <Tag aria-hidden className="h-3.5 w-3.5" />
          {item.category?.label ?? 'Categoria não informada'}
        </span>
      )}

      {showMisplaced && item.misplaced ? (
        <div className="bg-warning-bg flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
          <p className="text-warning">
            Lançado fora do cartão: “{item.misplaced.description}” ({formatDayMonth(item.misplaced.date)}) está{' '}
            {whereLabel(item.misplaced, cardName)}.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => item.misplaced && onMove(item.misplaced)}
              className={primaryButton}
            >
              {item.misplaced.cardId ? `Pôr no ${cardName(item.misplaced.cardId)}` : 'Pôr no cartão'}
            </button>
            {!item.misplaced.tied && (
              <button type="button" disabled={busy} onClick={onNotMisplaced} className={`${quietButton} flex-1`}>
                Não é este
              </button>
            )}
          </div>
        </div>
      ) : showUpfront && item.upfront && item.installments ? (
        <div className="bg-warning-bg flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
          <p className="text-warning">
            No Capital + está à vista: “{item.upfront.description}” ({formatBRL(item.upfront.amount)},{' '}
            {formatDayMonth(item.upfront.date)}). No banco são {item.installments.count}× de{' '}
            {formatBRL(item.installments.installmentAmount)}.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => item.upfront && onReplace(item.upfront)}
            className={primaryButton}
          >
            Trocar por parcelado
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => item.upfront && onKeepUpfront(item.upfront)}
            className={quietButton}
          >
            Deixar à vista
          </button>
          <button type="button" onClick={onNotUpfront} className="text-primary self-start text-xs font-semibold">
            É outra compra
          </button>
        </div>
      ) : item.partial ? (
        <div className="bg-warning-bg flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
          <p className="text-warning">
            Ligado a {namesOf(item.partial.entries)} (
            {formatBRL(item.partial.entries.reduce((sum, entry) => sum + entry.amount, 0))}). Faltam{' '}
            {formatBRL(item.partial.remaining)} no Capital +.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onLaunch} className={primaryButton}>
              Lançar o resto
            </button>
            <button type="button" disabled={busy} onClick={onAcceptPartial} className={`${quietButton} flex-1`}>
              Está certo assim
            </button>
          </div>
          <button type="button" disabled={busy} onClick={onUnlink} className="text-primary self-start text-xs font-semibold">
            Desfazer
          </button>
        </div>
      ) : showReceived && item.received ? (
        <div className="bg-success-bg flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
          <p className="text-success">
            É a devolução de “{item.received.description}” ({formatBRL(item.received.amount)}), que você já marcou como
            recebido?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => item.received && onLink([item.received], 'Pronto: ligado à devolução.')}
              className={primaryButton}
            >
              É sim
            </button>
            <button type="button" disabled={busy} onClick={onNotReceived} className={`${quietButton} flex-1`}>
              É outra coisa
            </button>
          </div>
        </div>
      ) : showPayback && item.reimbursement ? (
        <div className="bg-success-bg flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
          <p className="text-success">
            É a devolução de “{item.reimbursement.description}” ({formatBRL(item.reimbursement.amount)})?
          </p>
          {differenceLine(item.reimbursement, unforeseenLabel) && (
            <p className="text-foreground text-xs">{differenceLine(item.reimbursement, unforeseenLabel)}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => item.reimbursement && onPayback(item.reimbursement)}
              className={primaryButton}
            >
              Marcar como recebido
            </button>
            <button type="button" disabled={busy} onClick={onNotPayback} className={`${quietButton} flex-1`}>
              É outra coisa
            </button>
          </div>
          {item.reimbursement.others.length > 0 && (
            <button
              type="button"
              onClick={() => setOtherPaybacks((open) => !open)}
              aria-expanded={otherPaybacks}
              className="text-primary flex min-h-[36px] items-center gap-1 self-start text-sm font-semibold"
            >
              <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${otherPaybacks ? 'rotate-180' : ''}`} />
              É outro A receber
            </button>
          )}
          {otherPaybacks && (
            <ul className="divide-border flex flex-col divide-y">
              {item.reimbursement.others.map((option) => (
                <li key={option.expenseId} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate">
                      {option.description} · {formatBRL(option.amount)}
                    </span>
                    {differenceLine(option, unforeseenLabel) && (
                      <span className="text-muted block text-xs">{differenceLine(option, unforeseenLabel)}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPayback(option)}
                    className={`${quietButton} min-h-[36px] shrink-0`}
                  >
                    É este
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : showSplit && item.split ? (
        <div className="bg-warning-bg flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
          <p className="text-warning">
            Parecem ser estes {item.split.length} lançamentos: {namesOf(item.split)} (
            {item.split.map((entry) => formatBRL(entry.amount)).join(' + ')}).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => item.split && onLink(item.split, `Pronto: ligado aos ${item.split.length} lançamentos.`)}
              className={primaryButton}
            >
              São estes
            </button>
            <button type="button" disabled={busy} onClick={onNotSplit} className={`${quietButton} flex-1`}>
              Não são
            </button>
          </div>
        </div>
      ) : showDuplicate && item.duplicate ? (
        <div className="bg-warning-bg flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
          <p className="text-warning">
            Parece que você já lançou isso: “{item.duplicate.description}” ({formatBRL(item.duplicate.amount)},{' '}
            {formatDayMonth(item.duplicate.date)}).
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onSame} className={primaryButton}>
              É o mesmo
            </button>
            <button type="button" disabled={busy} onClick={onNotSame} className={`${quietButton} flex-1`}>
              É outro
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={onLaunch} className={primaryButton}>
            {launchLabel}
          </button>
          <button type="button" disabled={busy} onClick={onEdit} aria-label="Editar antes de lançar" className={quietButton}>
            <Pencil aria-hidden className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* What every line can do besides: tie it by hand, or ignore it. */}
      <div className="border-border -mx-4 -mb-1 flex items-center justify-between gap-3 border-t px-4 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSearch}
          className="text-primary flex min-h-[36px] items-center gap-1.5 text-sm font-semibold disabled:opacity-50"
        >
          <Search aria-hidden className="h-4 w-4" />
          {searchLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onIgnore}
          className="text-muted min-h-[36px] text-sm font-medium disabled:opacity-50"
        >
          Ignorar
        </button>
      </div>
    </li>
  );
}
