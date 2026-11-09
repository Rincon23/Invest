import 'server-only';
import { sql } from 'drizzle-orm';
import { user } from './db/schema';
import type { Database } from './db/types';
import { setAlertHandler, type GuardEventKind } from './loadGuard';
import { sendUserNotification } from './notify';

/**
 * Warnings about the server itself (a traffic spike, a pause, the board heating up, the e-mail
 * quota, an automatic test that started failing) go to the account whose e-mail is OWNER_EMAIL: to the bell in the app and, like any
 * notification, to the phone. Without OWNER_EMAIL they only reach the server log.
 */
export type ServerAlertKind = GuardEventKind | 'mail-limit' | 'self-test';

const TITLES: Record<ServerAlertKind, string> = {
  'rps-alert': '⚠️ Acesso alto no Capital +',
  'shed-start': '🛑 Capital + pausado para proteger o servidor',
  'shed-end': '✅ Capital + voltou ao normal',
  'ip-blocked': '🚫 Um IP foi bloqueado por excesso de acessos',
  'temp-alert': '🌡️ O Orange Pi está esquentando',
  'mail-limit': '📧 Limite de e-mails atingido',
  'self-test': '🧪 Um teste automático falhou',
};

async function ownerId(db: Database): Promise<string | null> {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`);
  return row?.id ?? null;
}

export async function notifyOwner(db: Database, kind: ServerAlertKind, body: string): Promise<void> {
  const id = await ownerId(db);
  if (!id) return;
  await sendUserNotification(db, id, {
    category: 'system',
    message: { title: TITLES[kind], body, url: '/admin', tag: `capital-alerta-${kind}` },
  });
}

/** Called once at start-up: the load guard's warnings become notifications to the owner. */
export function wireLoadGuardAlerts(getDb: () => Database): void {
  setAlertHandler((event) => {
    void notifyOwner(getDb(), event.kind, event.message).catch((err: unknown) =>
      console.error('[carga] falha ao avisar o dono:', err instanceof Error ? err.message : err),
    );
  });
}
