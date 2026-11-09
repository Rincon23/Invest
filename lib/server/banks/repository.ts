import 'server-only';
import { and, asc, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { type BankConnection, type BankConnectionStatus, type BankHoldings, type BankHolding, type HoldingsBank } from '@/lib/banks';
import { bankConnections, bankInvestments, bankKeys } from '../db/schema';
import type { Database } from '../db/types';
import { HttpError } from '../httpError';
import { decryptSecret, encryptSecret } from '../secretBox';

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

/** A bank the sync looks at: what Pluggy last said and how far the app already read. */
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

  /** "Desconectar": the key and every bank (their investments go with them). */
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
    const investments = await this.db
      .select({ itemId: bankInvestments.itemId })
      .from(bankInvestments)
      .where(eq(bankInvestments.userId, this.userId));
    return rows.map((row) => ({
      itemId: row.itemId,
      name: row.name ?? row.suggestedName ?? (row.status === 'pending' ? 'Banco chegando' : 'Banco'),
      named: row.name !== null,
      status: row.status,
      lastUpdatedAt: row.lastUpdatedAt?.toISOString() ?? null,
      nextAutoSyncAt: row.nextAutoSyncAt?.toISOString() ?? null,
      consentExpiresAt: row.consentExpiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      investments: investments.filter((investment) => investment.itemId === row.itemId).length,
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
   * The investments as the last read brought them. An empty read changes nothing: a broker never
   * loses every position at once, Pluggy only stumbles.
   */
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
   * quantities (lib/banks/holdings.ts). `outside` is filled by the route, from the Diagrama.
   */
  async holdings(): Promise<Omit<BankHoldings, 'outside'>> {
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
        },
      ];
    });
    return { banks, holdings };
  }

  /** The name each bank shows (the person's, or the suggested one). */
  async connectionNames(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ itemId: bankConnections.itemId, name: bankConnections.name, suggested: bankConnections.suggestedName })
      .from(bankConnections)
      .where(eq(bankConnections.userId, this.userId));
    return new Map(rows.map((row) => [row.itemId, row.name ?? row.suggested ?? 'Banco']));
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

  /** The person's own name for a bank; null goes back to the suggestion. */
  async rename(itemId: string, name: string | null): Promise<void> {
    const updated = await this.db
      .update(bankConnections)
      .set({ name })
      .where(and(eq(bankConnections.userId, this.userId), eq(bankConnections.itemId, itemId)))
      .returning({ itemId: bankConnections.itemId });
    if (updated.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Este banco não está mais no Invest +.');
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
