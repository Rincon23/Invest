import 'server-only';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  alertSettingsOf,
  investmentLabel,
  isUsualReserve,
  type BankAccountKind,
  type BankConnection,
  type BankConnectionStatus,
  type BankAlertSettings,
  type CategoryChoice,
  type ReviewCard,
  type ReviewTransaction,
  type BankReserve,
  type ReserveSource,
  type BankHolding,
  type BankHoldings,
  type HoldingsBank,
  payerKey,
  type PaybackHistory,
  type LinkedEntry,
} from '@/lib/banks';
import { round2 } from '@/lib/budget/money';
import {
  bankAccounts,
  bankCategoryMemory,
  bankLinks,
  bankConnections,
  bankInvestments,
  bankKeys,
  bankSettings,
  bankTransactions,
  cashSettings,
  expenses,
  incomes,
  investmentReserves,
} from '../db/schema';
import type { Database } from '../db/types';
import { HttpError } from '../httpError';
import { decryptSecret, encryptSecret } from '../secretBox';

export interface StoredAccount {
  accountId: string;
  kind: BankAccountKind;
  name: string;
  balance: number | null;
  currency: string | null;
  balanceAt?: Date | null;
  creditLimit?: number | null;
  availableCredit?: number | null;
  dueDate?: string | null;
}

/** A tie made by hand from a bank transaction to an entry, with the entry as it is now. */
export interface BankLink extends LinkedEntry {
  transactionId: string;
  kind: 'expense' | 'income';
  /** An "A receber" (an expense the person is owed). */
  reimbursable: boolean;
  /** The bank and day of the transaction. */
  bankName: string;
  date: string;
}

/** A transaction to review, with what the review shows about its account and bank. */
export interface ReviewRow extends ReviewTransaction {
  accountName: string;
  bankName: string;
  capitalCardId: string | null;
  cardLinked: boolean;
  /** What it became in the Capital (null: nobody decided yet). */
  outcome: string | null;
  entryId: string | null;
  entryMonth: string | null;
}

export interface StoredInvestment {
  investmentId: string;
  name: string;
  type: string | null;
  subtype: string | null;
  code?: string | null;
  isin?: string | null;
  quantity?: number | null;
  balance: number | null;
  balanceAt: Date | null;
}

/** A transaction as the Capital keeps it (`bank_transactions`), without what it became. */
export type StoredTransaction = Omit<
  typeof bankTransactions.$inferInsert,
  'userId' | 'outcome' | 'entryId' | 'createdAt' | 'updatedAt'
>;

/** What the last read of an item said about it. */
export interface ConnectionUpdate {
  status: BankConnectionStatus;
  lastUpdatedAt?: Date | null;
  nextAutoSyncAt?: Date | null;
  consentExpiresAt?: Date | null;
  suggestedName?: string;
  checkedAt?: Date;
  /** The `lastUpdatedAt` whose data was just read in full. */
  syncedUpdateAt?: Date | null;
}

/** A bank the sync looks at: what Pluggy last said and how far the Capital already read. */
export interface SyncedConnection {
  itemId: string;
  status: BankConnectionStatus;
  lastUpdatedAt: Date | null;
  syncedUpdateAt: Date | null;
}

export interface PendingConnection {
  itemId: string;
  authorizeExpiresAt: Date | null;
  createdAt: Date;
}

/** What a later read may change in a known transaction (never what the person decided about it). */
const TRANSACTION_FIELDS = [
  'accountId',
  'date',
  'amount',
  'currency',
  'description',
  'descriptionRaw',
  'type',
  'status',
  'category',
  'operationType',
  'paymentMethod',
  'payerName',
  'payerDocument',
  'receiverName',
  'receiverDocument',
  'merchantName',
  'installmentNumber',
  'totalInstallments',
  'purchaseDate',
  'billId',
] as const;

/** One person's Open Finance: their Pluggy key and the banks (items) they brought. */
export class PostgresBanksRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  /** What the screen may see of the key: never the Secret. */
  async getKey(): Promise<{ clientId: string; secretHint: string } | null> {
    const [row] = await this.db
      .select({ clientId: bankKeys.clientId, secretHint: bankKeys.secretHint })
      .from(bankKeys)
      .where(eq(bankKeys.userId, this.userId));
    return row ?? null;
  }

  /** The key, decrypted, for the server's own calls to Pluggy. */
  async getCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
    const [row] = await this.db.select().from(bankKeys).where(eq(bankKeys.userId, this.userId));
    if (!row) return null;
    return { clientId: row.clientId, clientSecret: decryptSecret(row.clientSecret) };
  }

  async saveKey(clientId: string, clientSecret: string): Promise<void> {
    const values = {
      clientId,
      clientSecret: encryptSecret(clientSecret),
      secretHint: clientSecret.slice(-4),
    };
    await this.db
      .insert(bankKeys)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: bankKeys.userId, set: values });
  }

  /** "Desconectar": the key and every bank (their accounts go with them). */
  async deleteAll(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(bankConnections).where(eq(bankConnections.userId, this.userId));
      await tx.delete(bankKeys).where(eq(bankKeys.userId, this.userId));
    });
  }

  async listConnections(): Promise<BankConnection[]> {
    const rows = await this.db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.userId, this.userId))
      .orderBy(asc(bankConnections.createdAt));
    const accounts = await this.db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, this.userId))
      .orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.name));
    return rows.map((row) => ({
      itemId: row.itemId,
      name: row.name ?? row.suggestedName ?? (row.status === 'pending' ? 'Banco chegando' : 'Banco'),
      named: row.name !== null,
      status: row.status,
      lastUpdatedAt: row.lastUpdatedAt?.toISOString() ?? null,
      nextAutoSyncAt: row.nextAutoSyncAt?.toISOString() ?? null,
      consentExpiresAt: row.consentExpiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      accounts: accounts
        .filter((account) => account.itemId === row.itemId)
        // Never the balance, limit or due date: they stay here for the Reserva only.
        .map((account) => ({ id: account.accountId, kind: account.kind, name: account.name })),
    }));
  }

  /** Every bank past its arrival, for the sync. */
  async connectionsToSync(): Promise<SyncedConnection[]> {
    return this.db
      .select({
        itemId: bankConnections.itemId,
        status: bankConnections.status,
        lastUpdatedAt: bankConnections.lastUpdatedAt,
        syncedUpdateAt: bankConnections.syncedUpdateAt,
      })
      .from(bankConnections)
      .where(and(eq(bankConnections.userId, this.userId), ne(bankConnections.status, 'pending')))
      .orderBy(asc(bankConnections.createdAt));
  }

  /**
   * Keeps what a read brought, by Pluggy's id: new transactions are added, known ones updated
   * (pending → posted), and what the person decided about them is never touched. Answers the ids
   * that were new.
   */
  async upsertTransactions(transactions: StoredTransaction[]): Promise<string[]> {
    const added: string[] = [];
    for (let start = 0; start < transactions.length; start += 200) {
      const chunk = transactions.slice(start, start + 200).map((row) => ({ ...row, userId: this.userId }));
      const rows = await this.db
        .insert(bankTransactions)
        .values(chunk)
        .onConflictDoUpdate({
          target: [bankTransactions.userId, bankTransactions.transactionId],
          set: {
            ...Object.fromEntries(
              TRANSACTION_FIELDS.map((field) => [field, sql.raw(`excluded."${bankTransactions[field].name}"`)]),
            ),
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: bankTransactions.transactionId, added: sql<boolean>`(xmax = 0)` });
      for (const row of rows) if (row.added) added.push(row.id);
    }
    return added;
  }

  /** The investments as the last read brought them (an empty read changes nothing, as with accounts). */
  async replaceInvestments(itemId: string, investments: StoredInvestment[]): Promise<void> {
    if (investments.length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx.delete(bankInvestments).where(
        and(
          eq(bankInvestments.userId, this.userId),
          eq(bankInvestments.itemId, itemId),
          notInArray(
            bankInvestments.investmentId,
            investments.map((investment) => investment.investmentId),
          ),
        ),
      );
      for (const investment of investments) {
        const values = {
          itemId,
          name: investment.name,
          type: investment.type,
          subtype: investment.subtype,
          code: investment.code ?? null,
          isin: investment.isin ?? null,
          quantity: investment.quantity ?? null,
          balance: investment.balance,
          balanceAt: investment.balanceAt,
        };
        await tx
          .insert(bankInvestments)
          .values({ userId: this.userId, investmentId: investment.investmentId, ...values })
          .onConflictDoUpdate({ target: [bankInvestments.userId, bankInvestments.investmentId], set: values });
      }
    });
  }

  /**
   * Every investment of the banks that arrived, with its bank, for the Diagrama to compare
   * quantities (lib/banks/holdings.ts). `reserve` is filled by the route, which knows the modules.
   */
  async holdings(): Promise<Omit<BankHoldings, 'reserve'>> {
    const connections = await this.db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.userId, this.userId), ne(bankConnections.status, 'pending')))
      .orderBy(asc(bankConnections.createdAt));
    const rows = await this.db
      .select()
      .from(bankInvestments)
      .where(eq(bankInvestments.userId, this.userId))
      .orderBy(asc(bankInvestments.name));
    const banks: HoldingsBank[] = connections
      .filter((connection) => rows.some((row) => row.itemId === connection.itemId))
      .map((connection) => ({
        itemId: connection.itemId,
        name: connection.name ?? connection.suggestedName ?? 'Banco',
        status: connection.status,
        lastUpdatedAt: connection.lastUpdatedAt?.toISOString() ?? null,
      }));
    const holdings: BankHolding[] = rows.flatMap((row) => {
      const bank = banks.find((candidate) => candidate.itemId === row.itemId);
      if (!bank) return [];
      return [
        {
          investmentId: row.investmentId,
          itemId: row.itemId,
          bankName: bank.name,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          code: row.code,
          isin: row.isin,
          quantity: row.quantity,
          feedsReserve: row.feedsReserve,
        },
      ];
    });
    return { banks, holdings };
  }

  /** The Reserva investida's ticker and quotas (null when it holds none). */
  async investedReserve(): Promise<BankHoldings['reserve']> {
    const [row] = await this.db
      .select({ ticker: investmentReserves.ticker, quotas: investmentReserves.totalQuotas })
      .from(investmentReserves)
      .where(eq(investmentReserves.userId, this.userId));
    return row && row.quotas > 0 ? row : null;
  }

  /** What can feed the Reserva, bank by bank, and the sum of what the person marked. */
  async reserve(): Promise<BankReserve> {
    const connections = await this.db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.userId, this.userId), ne(bankConnections.status, 'pending')))
      .orderBy(asc(bankConnections.createdAt));
    const accounts = await this.db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.userId, this.userId), ne(bankAccounts.kind, 'card')))
      .orderBy(asc(bankAccounts.name));
    const investments = await this.db
      .select()
      .from(bankInvestments)
      .where(eq(bankInvestments.userId, this.userId))
      .orderBy(asc(bankInvestments.name));

    let total: number | null = null;
    const add = (marked: boolean, balance: number | null) => {
      if (marked) total = round2((total ?? 0) + (balance ?? 0));
    };
    const banks = connections.map((connection) => {
      const sources: ReserveSource[] = [
        ...accounts
          .filter((account) => account.itemId === connection.itemId)
          .map((account) => {
            add(account.feedsReserve, account.balance);
            return {
              id: account.accountId,
              kind: 'account' as const,
              name: account.name,
              detail: account.kind === 'savings' ? 'poupança' : 'conta',
              usual: true,
              balance: account.balance,
              marked: account.feedsReserve,
            };
          }),
        ...investments
          .filter((investment) => investment.itemId === connection.itemId)
          .map((investment) => {
            add(investment.feedsReserve, investment.balance);
            return {
              id: investment.investmentId,
              kind: 'investment' as const,
              name: investment.name,
              detail: investmentLabel(investment.type, investment.subtype),
              usual: isUsualReserve(investment.type),
              balance: investment.balance,
              marked: investment.feedsReserve,
            };
          }),
      ];
      return {
        itemId: connection.itemId,
        name: connection.name ?? connection.suggestedName ?? 'Banco',
        status: connection.status,
        lastUpdatedAt: connection.lastUpdatedAt?.toISOString() ?? null,
        sources,
      };
    });
    return { banks: banks.filter((bank) => bank.sources.length > 0), total };
  }

  /** Marks exactly these accounts and investments as the reserve (none: back to typing it). */
  async setReserveSources(accountIds: string[], investmentIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(bankAccounts)
        .set({ feedsReserve: accountIds.length ? inArray(bankAccounts.accountId, accountIds) : sql`false` })
        .where(eq(bankAccounts.userId, this.userId));
      await tx
        .update(bankInvestments)
        .set({
          feedsReserve: investmentIds.length ? inArray(bankInvestments.investmentId, investmentIds) : sql`false`,
        })
        .where(eq(bankInvestments.userId, this.userId));
    });
  }

  /**
   * Writes the sum of the marked balances as the Reserva's "Reserva em conta". Nothing marked:
   * nothing is written (the person types it). Answers what was written.
   */
  async writeReserve(): Promise<number | null> {
    const { total } = await this.reserve();
    if (total === null) return null;
    await this.db
      .insert(cashSettings)
      .values({ userId: this.userId, reserveAccountAmount: total })
      .onConflictDoUpdate({ target: cashSettings.userId, set: { reserveAccountAmount: total } });
    return total;
  }

  /** What to alert about (the defaults until the person changes anything). */
  async alertSettings(): Promise<BankAlertSettings> {
    const [row] = await this.db
      .select({ alerts: bankSettings.alerts })
      .from(bankSettings)
      .where(eq(bankSettings.userId, this.userId));
    return alertSettingsOf(row?.alerts);
  }

  async saveAlertSettings(alerts: BankAlertSettings): Promise<void> {
    await this.db
      .insert(bankSettings)
      .values({ userId: this.userId, alerts })
      .onConflictDoUpdate({ target: bankSettings.userId, set: { alerts } });
  }

  // -------------------------------------------------------------------------
  // The month's check
  // -------------------------------------------------------------------------

  /**
   * What a month's check reads, whatever was decided about it: every transaction dated from `from`
   * to `to`, and every instalment of a split card purchase of any date (the instalment of a month
   * may have come months before, or not at all yet).
   */
  async reviewTransactions(from: string, to: string): Promise<ReviewRow[]> {
    return this.db
      .select({
        id: bankTransactions.transactionId,
        accountId: bankTransactions.accountId,
        accountKind: bankAccounts.kind,
        accountName: bankAccounts.name,
        capitalCardId: bankAccounts.capitalCardId,
        cardLinked: bankAccounts.cardLinked,
        bankName: sql<string>`coalesce(${bankConnections.name}, ${bankConnections.suggestedName}, 'Banco')`,
        date: bankTransactions.date,
        amount: bankTransactions.amount,
        type: bankTransactions.type,
        description: bankTransactions.description,
        category: bankTransactions.category,
        operationType: bankTransactions.operationType,
        paymentMethod: bankTransactions.paymentMethod,
        payerName: bankTransactions.payerName,
        payerDocument: bankTransactions.payerDocument,
        receiverName: bankTransactions.receiverName,
        receiverDocument: bankTransactions.receiverDocument,
        descriptionRaw: bankTransactions.descriptionRaw,
        merchantName: bankTransactions.merchantName,
        installmentNumber: bankTransactions.installmentNumber,
        totalInstallments: bankTransactions.totalInstallments,
        purchaseDate: bankTransactions.purchaseDate,
        outcome: bankTransactions.outcome,
        entryId: bankTransactions.entryId,
        entryMonth: bankTransactions.entryMonth,
      })
      .from(bankTransactions)
      .innerJoin(
        bankAccounts,
        and(eq(bankAccounts.userId, bankTransactions.userId), eq(bankAccounts.accountId, bankTransactions.accountId)),
      )
      .innerJoin(
        bankConnections,
        and(eq(bankConnections.userId, bankAccounts.userId), eq(bankConnections.itemId, bankAccounts.itemId)),
      )
      .where(
        and(
          eq(bankTransactions.userId, this.userId),
          or(
            and(gte(bankTransactions.date, from), lte(bankTransactions.date, to)),
            and(eq(bankAccounts.kind, 'card'), gt(bankTransactions.totalInstallments, 1)),
          ),
        ),
      )
      .orderBy(desc(bankTransactions.date));
  }

  /**
   * Every transaction that says who is on the other side, for the names the banks told by CPF/CNPJ
   * (`namesByDocument`): one bank names a person, another sends only the CPF.
   */
  async counterparts() {
    return this.db
      .select({
        type: bankTransactions.type,
        payerName: bankTransactions.payerName,
        payerDocument: bankTransactions.payerDocument,
        receiverName: bankTransactions.receiverName,
        receiverDocument: bankTransactions.receiverDocument,
        descriptionRaw: bankTransactions.descriptionRaw,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, this.userId),
          sql`(${bankTransactions.payerName} is not null or ${bankTransactions.receiverName} is not null or ${bankTransactions.descriptionRaw} like '%|%')`,
        ),
      );
  }

  /**
   * The entries already tied to a bank transaction, with the bank and day of it: never offered as
   * the duplicate of another, and shown as taken in "Procurar nos gastos".
   */
  async tiedEntries(): Promise<Map<string, { bankName: string; date: string; transactionId: string }>> {
    const rows = await this.db
      .select({
        entryId: bankTransactions.entryId,
        transactionId: bankTransactions.transactionId,
        date: bankTransactions.date,
        bankName: sql<string>`coalesce(${bankConnections.name}, ${bankConnections.suggestedName}, 'Banco')`,
      })
      .from(bankTransactions)
      .innerJoin(
        bankAccounts,
        and(eq(bankAccounts.userId, bankTransactions.userId), eq(bankAccounts.accountId, bankTransactions.accountId)),
      )
      .innerJoin(
        bankConnections,
        and(eq(bankConnections.userId, bankAccounts.userId), eq(bankConnections.itemId, bankAccounts.itemId)),
      )
      .where(and(eq(bankTransactions.userId, this.userId), sql`${bankTransactions.entryId} is not null`));
    return new Map(
      rows.map((row) => [row.entryId!, { bankName: row.bankName, date: row.date, transactionId: row.transactionId }]),
    );
  }

  /**
   * The ties made by hand ("Procurar nos gastos"), with the entry each points at as it is now — a
   * tie whose entry is gone is left out — and the bank and day of the transaction.
   */
  async links(): Promise<BankLink[]> {
    const rows = await this.db
      .select({
        transactionId: bankLinks.transactionId,
        entryId: bankLinks.entryId,
        month: bankLinks.entryMonth,
        date: bankTransactions.date,
        bankName: sql<string>`coalesce(${bankConnections.name}, ${bankConnections.suggestedName}, 'Banco')`,
        expenseDescription: expenses.description,
        expenseAmount: expenses.amount,
        expenseKind: expenses.categoryKind,
        incomeSource: incomes.source,
        incomeAmount: incomes.amount,
      })
      .from(bankLinks)
      .innerJoin(
        bankTransactions,
        and(eq(bankTransactions.userId, bankLinks.userId), eq(bankTransactions.transactionId, bankLinks.transactionId)),
      )
      .innerJoin(
        bankAccounts,
        and(eq(bankAccounts.userId, bankTransactions.userId), eq(bankAccounts.accountId, bankTransactions.accountId)),
      )
      .innerJoin(
        bankConnections,
        and(eq(bankConnections.userId, bankAccounts.userId), eq(bankConnections.itemId, bankAccounts.itemId)),
      )
      .leftJoin(
        expenses,
        and(eq(expenses.userId, bankLinks.userId), eq(expenses.id, bankLinks.entryId), eq(expenses.month, bankLinks.entryMonth)),
      )
      .leftJoin(
        incomes,
        and(eq(incomes.userId, bankLinks.userId), eq(incomes.id, bankLinks.entryId), eq(incomes.month, bankLinks.entryMonth)),
      )
      .where(eq(bankLinks.userId, this.userId))
      .orderBy(asc(bankLinks.createdAt));
    return rows.flatMap((row): BankLink[] => {
      const base = { transactionId: row.transactionId, entryId: row.entryId, month: row.month, bankName: row.bankName, date: row.date };
      if (row.expenseDescription !== null && row.expenseAmount !== null) {
        return [
          {
            ...base,
            kind: 'expense',
            description: row.expenseDescription,
            amount: row.expenseAmount,
            reimbursable: row.expenseKind === 'reimbursable',
          },
        ];
      }
      if (row.incomeSource !== null && row.incomeAmount !== null) {
        return [{ ...base, kind: 'income', description: row.incomeSource, amount: row.incomeAmount, reimbursable: false }];
      }
      return [];
    });
  }

  /** Ties these transactions (one line) to these entries; tying twice changes nothing. */
  async addLinks(transactionIds: string[], entries: { month: string; entryId: string }[]): Promise<void> {
    const values = transactionIds.flatMap((transactionId) =>
      entries.map((entry) => ({ userId: this.userId, transactionId, entryId: entry.entryId, entryMonth: entry.month })),
    );
    if (values.length > 0) await this.db.insert(bankLinks).values(values).onConflictDoNothing();
  }

  /** "Desfazer": the line's ties by hand go away (nothing else is touched). */
  async removeLinks(transactionIds: string[]): Promise<void> {
    if (transactionIds.length === 0) return;
    await this.db
      .delete(bankLinks)
      .where(and(eq(bankLinks.userId, this.userId), inArray(bankLinks.transactionId, transactionIds)));
  }

  /** Whether every one of these transactions exists and nobody decided about it yet. */
  async undecided(transactionIds: string[]): Promise<boolean> {
    const rows = await this.db
      .select({ id: bankTransactions.transactionId })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, this.userId),
          inArray(bankTransactions.transactionId, transactionIds),
          isNull(bankTransactions.outcome),
        ),
      );
    return rows.length === new Set(transactionIds).size;
  }

  /** The bank cards, with the Capital card each is tied to. */
  async reviewCards(): Promise<ReviewCard[]> {
    const rows = await this.db
      .select({
        accountId: bankAccounts.accountId,
        name: bankAccounts.name,
        cardId: bankAccounts.capitalCardId,
        linked: bankAccounts.cardLinked,
        bankName: sql<string>`coalesce(${bankConnections.name}, ${bankConnections.suggestedName}, 'Banco')`,
      })
      .from(bankAccounts)
      .innerJoin(
        bankConnections,
        and(eq(bankConnections.userId, bankAccounts.userId), eq(bankConnections.itemId, bankAccounts.itemId)),
      )
      .where(and(eq(bankAccounts.userId, this.userId), eq(bankAccounts.kind, 'card')))
      .orderBy(asc(bankAccounts.name));
    return rows;
  }

  /** Ties a bank card to a Capital card (null: "não informado"). */
  async linkCard(accountId: string, cardId: string | null): Promise<void> {
    const updated = await this.db
      .update(bankAccounts)
      .set({ capitalCardId: cardId, cardLinked: true })
      .where(
        and(eq(bankAccounts.userId, this.userId), eq(bankAccounts.accountId, accountId), eq(bankAccounts.kind, 'card')),
      )
      .returning({ id: bankAccounts.accountId });
    if (updated.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Este cartão não está mais no Capital +.');
  }

  /**
   * Takes these transactions for one decision: only the ones nobody decided about yet. False when
   * any of them was already decided (another tap, another device) — and then none is taken.
   */
  async claim(transactionIds: string[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const taken = await tx
        .update(bankTransactions)
        .set({ outcome: 'launching' })
        .where(
          and(
            eq(bankTransactions.userId, this.userId),
            inArray(bankTransactions.transactionId, transactionIds),
            isNull(bankTransactions.outcome),
          ),
        )
        .returning({ id: bankTransactions.transactionId });
      if (taken.length === new Set(transactionIds).size) return true;
      await tx
        .update(bankTransactions)
        .set({ outcome: null })
        .where(
          and(
            eq(bankTransactions.userId, this.userId),
            inArray(
              bankTransactions.transactionId,
              taken.map((row) => row.id),
            ),
          ),
        );
      return false;
    });
  }

  /** What the claimed transactions became. */
  async settle(transactionIds: string[], outcome: string, entryId: string | null, entryMonth: string | null): Promise<void> {
    await this.db
      .update(bankTransactions)
      .set({ outcome, entryId, entryMonth })
      .where(
        and(
          eq(bankTransactions.userId, this.userId),
          inArray(bankTransactions.transactionId, transactionIds),
          eq(bankTransactions.outcome, 'launching'),
        ),
      );
  }

  /**
   * "Voltar para conferir": ignored transactions go back to nobody having decided about them. Only
   * ignored ones: false when any of these is not (another device decided first) — and then none is.
   */
  async restore(transactionIds: string[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const restored = await tx
        .update(bankTransactions)
        .set({ outcome: null, entryId: null, entryMonth: null })
        .where(
          and(
            eq(bankTransactions.userId, this.userId),
            inArray(bankTransactions.transactionId, transactionIds),
            eq(bankTransactions.outcome, 'ignored'),
          ),
        )
        .returning({ id: bankTransactions.transactionId });
      if (restored.length === new Set(transactionIds).size) return true;
      await tx
        .update(bankTransactions)
        .set({ outcome: 'ignored' })
        .where(
          and(
            eq(bankTransactions.userId, this.userId),
            inArray(
              bankTransactions.transactionId,
              restored.map((row) => row.id),
            ),
          ),
        );
      return false;
    });
  }

  /** Gives claimed transactions back (the launch failed). */
  async release(transactionIds: string[]): Promise<void> {
    await this.db
      .update(bankTransactions)
      .set({ outcome: null })
      .where(
        and(
          eq(bankTransactions.userId, this.userId),
          inArray(bankTransactions.transactionId, transactionIds),
          eq(bankTransactions.outcome, 'launching'),
        ),
      );
  }

  /** What a few transactions add up to (always positive) and the day of the last one: a Pix being reviewed. */
  async paidIn(transactionIds: string[]): Promise<{ amount: number; date: string } | null> {
    const rows = await this.db
      .select({ amount: bankTransactions.amount, date: bankTransactions.date })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.userId, this.userId), inArray(bankTransactions.transactionId, transactionIds)));
    if (rows.length === 0) return null;
    return {
      amount: round2(rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)),
      date: rows.map((row) => row.date).sort()[rows.length - 1],
    };
  }

  /**
   * Who paid back which "A receber" before ("Marcar como recebido"): the Pix's payer and the
   * description of the "A receber" it settled, for the review to recognise the payer next time.
   */
  async paybackHistory(): Promise<PaybackHistory[]> {
    const rows = await this.db
      .select({
        payerDocument: bankTransactions.payerDocument,
        payerName: bankTransactions.payerName,
        description: expenses.description,
      })
      .from(bankTransactions)
      .innerJoin(
        expenses,
        and(
          eq(expenses.userId, bankTransactions.userId),
          eq(expenses.id, bankTransactions.entryId),
          eq(expenses.month, bankTransactions.entryMonth),
        ),
      )
      .where(and(eq(bankTransactions.userId, this.userId), eq(bankTransactions.outcome, 'reimbursed')));
    // A Pix tied by hand to an "A receber" teaches the same.
    const tiedByHand = await this.db
      .select({
        payerDocument: bankTransactions.payerDocument,
        payerName: bankTransactions.payerName,
        description: expenses.description,
      })
      .from(bankLinks)
      .innerJoin(
        bankTransactions,
        and(eq(bankTransactions.userId, bankLinks.userId), eq(bankTransactions.transactionId, bankLinks.transactionId)),
      )
      .innerJoin(
        expenses,
        and(eq(expenses.userId, bankLinks.userId), eq(expenses.id, bankLinks.entryId), eq(expenses.month, bankLinks.entryMonth)),
      )
      .where(
        and(
          eq(bankLinks.userId, this.userId),
          eq(bankTransactions.type, 'CREDIT'),
          eq(expenses.categoryKind, 'reimbursable'),
        ),
      );
    return [...rows, ...tiedByHand].flatMap((row) => {
      const payer = payerKey(row);
      return payer ? [{ payer, description: row.description }] : [];
    });
  }

  async descriptionOf(transactionId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ description: bankTransactions.description })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.userId, this.userId), eq(bankTransactions.transactionId, transactionId)));
    return row?.description ?? null;
  }

  async categoryMemory(): Promise<Map<string, CategoryChoice>> {
    const rows = await this.db.select().from(bankCategoryMemory).where(eq(bankCategoryMemory.userId, this.userId));
    return new Map(
      rows.map((row) => [row.key, { categoryKind: row.categoryKind, ...(row.topicId ? { topicId: row.topicId } : {}) }]),
    );
  }

  /** The next transaction that reads like `key` is suggested this category. */
  async remember(key: string, choice: CategoryChoice): Promise<void> {
    if (!key) return;
    const values = { categoryKind: choice.categoryKind, topicId: choice.topicId ?? null };
    await this.db
      .insert(bankCategoryMemory)
      .values({ userId: this.userId, key, ...values })
      .onConflictDoUpdate({ target: [bankCategoryMemory.userId, bankCategoryMemory.key], set: values });
  }

  /** The name each bank shows (the person's, or the suggested one). */
  async connectionNames(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ itemId: bankConnections.itemId, name: bankConnections.name, suggested: bankConnections.suggestedName })
      .from(bankConnections)
      .where(eq(bankConnections.userId, this.userId));
    return new Map(rows.map((row) => [row.itemId, row.name ?? row.suggested ?? 'Banco']));
  }

  async countTransactions(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bankTransactions)
      .where(eq(bankTransactions.userId, this.userId));
    return row?.count ?? 0;
  }

  async itemIds(): Promise<string[]> {
    const rows = await this.db
      .select({ itemId: bankConnections.itemId })
      .from(bankConnections)
      .where(eq(bankConnections.userId, this.userId));
    return rows.map((row) => row.itemId);
  }

  /** The banks still on their way (the ones that failed are the sync's, which reads them again). */
  async pendingConnections(): Promise<PendingConnection[]> {
    return this.db
      .select({
        itemId: bankConnections.itemId,
        authorizeExpiresAt: bankConnections.authorizeExpiresAt,
        createdAt: bankConnections.createdAt,
      })
      .from(bankConnections)
      .where(and(eq(bankConnections.userId, this.userId), eq(bankConnections.status, 'pending')));
  }

  async addPending(itemId: string, authorizeExpiresAt: Date | null): Promise<void> {
    await this.db
      .insert(bankConnections)
      .values({ userId: this.userId, itemId, status: 'pending', authorizeExpiresAt })
      .onConflictDoNothing();
  }

  async setAuthorizeExpiry(itemId: string, authorizeExpiresAt: Date | null): Promise<void> {
    await this.db
      .update(bankConnections)
      .set({ authorizeExpiresAt })
      .where(and(eq(bankConnections.userId, this.userId), eq(bankConnections.itemId, itemId)));
  }

  async updateConnection(itemId: string, update: ConnectionUpdate): Promise<void> {
    await this.db
      .update(bankConnections)
      .set({
        status: update.status,
        ...(update.lastUpdatedAt !== undefined ? { lastUpdatedAt: update.lastUpdatedAt } : {}),
        ...(update.nextAutoSyncAt !== undefined ? { nextAutoSyncAt: update.nextAutoSyncAt } : {}),
        ...(update.consentExpiresAt !== undefined ? { consentExpiresAt: update.consentExpiresAt } : {}),
        ...(update.suggestedName !== undefined ? { suggestedName: update.suggestedName } : {}),
        ...(update.checkedAt !== undefined ? { checkedAt: update.checkedAt } : {}),
        ...(update.syncedUpdateAt !== undefined ? { syncedUpdateAt: update.syncedUpdateAt } : {}),
        ...(update.status !== 'pending' ? { authorizeExpiresAt: null } : {}),
      })
      .where(and(eq(bankConnections.userId, this.userId), eq(bankConnections.itemId, itemId)));
  }

  /**
   * The accounts as the last read brought them: new ones added, the rest updated, gone ones removed
   * (with their transactions). An empty read changes nothing: a bank never loses every account at
   * once, Pluggy only stumbles.
   */
  async replaceAccounts(itemId: string, accounts: StoredAccount[]): Promise<void> {
    if (accounts.length === 0) return;
    await this.db.transaction(async (tx) => {
      const ids = accounts.map((account) => account.accountId);
      await tx
        .delete(bankAccounts)
        .where(
          and(
            eq(bankAccounts.userId, this.userId),
            eq(bankAccounts.itemId, itemId),
            notInArray(bankAccounts.accountId, ids),
          ),
        );
      for (const account of accounts) {
        const values = {
          itemId,
          kind: account.kind,
          name: account.name,
          balance: account.balance,
          currency: account.currency,
          balanceAt: account.balanceAt ?? null,
          creditLimit: account.creditLimit ?? null,
          availableCredit: account.availableCredit ?? null,
          dueDate: account.dueDate ?? null,
        };
        await tx
          .insert(bankAccounts)
          .values({ userId: this.userId, accountId: account.accountId, ...values })
          .onConflictDoUpdate({ target: [bankAccounts.userId, bankAccounts.accountId], set: values });
      }
    });
  }

  /** The person's own name for a bank; null goes back to the suggestion. */
  async rename(itemId: string, name: string | null): Promise<void> {
    const updated = await this.db
      .update(bankConnections)
      .set({ name })
      .where(and(eq(bankConnections.userId, this.userId), eq(bankConnections.itemId, itemId)))
      .returning({ itemId: bankConnections.itemId });
    if (updated.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Este banco não está mais no Capital +.');
  }

  async deleteConnections(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await this.db
      .delete(bankConnections)
      .where(and(eq(bankConnections.userId, this.userId), inArray(bankConnections.itemId, itemIds)));
  }

  async hasConnection(itemId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ itemId: bankConnections.itemId })
      .from(bankConnections)
      .where(and(eq(bankConnections.userId, this.userId), eq(bankConnections.itemId, itemId)));
    return row !== undefined;
  }
}
