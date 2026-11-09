import 'server-only';
import { eq } from 'drizzle-orm';
import { bankConnections, bankKeys, notifications, settings } from './db/schema';
import type { Database } from './db/types';
import { PostgresBanksRepository } from './banks/repository';
import { disconnectAll, forgetPluggyKey } from './banks/service';
import { PostgresDiagramRepository } from './diagramRepository';

/**
 * "Apagar todos os dados": everything the account stored — settings, the Diagrama, the Open
 * Finance key and banks and the notification history. The account itself stays, and so do the
 * devices that receive notifications; "Excluir minha conta" removes those too. Rows that hang from
 * others (answers, investments) go with them by cascade.
 */
export async function clearAccountData(db: Database, userId: string): Promise<void> {
  // The banks leave the person's Pluggy application too, while the key to reach it still exists.
  await disconnectAll(new PostgresBanksRepository(db, userId), userId).catch(() => undefined);
  await db.transaction(async (tx) => {
    await tx.delete(settings).where(eq(settings.userId, userId));
    await new PostgresDiagramRepository(db, userId).clear(tx);
    await tx.delete(bankConnections).where(eq(bankConnections.userId, userId));
    await tx.delete(bankKeys).where(eq(bankKeys.userId, userId));
    await tx.delete(notifications).where(eq(notifications.userId, userId));
  });
  forgetPluggyKey(userId);
}
