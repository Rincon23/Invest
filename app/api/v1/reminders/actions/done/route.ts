import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/server/db';
import { HttpError } from '@/lib/server/httpError';
import { verifyReminderAction } from '@/lib/server/reminderActionToken';
import { PostgresRemindersRepository } from '@/lib/server/remindersRepository';
import { actionTokenSchema } from '@/lib/server/validation';

/**
 * "Realizado ✅" tapped on a notification. Called by the service worker, possibly with no
 * session at all: the signed token is the authorization, and it only completes the reminder
 * and day it was issued for.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  const body: unknown = await request.json().catch(() => null);
  const parsed = actionTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.', code: 'INVALID_INPUT' }, { status: 400, headers });
  }

  const verified = verifyReminderAction(parsed.data.token);
  if (!verified.ok) {
    const message =
      verified.reason === 'expired'
        ? 'Esse aviso expirou. Abra o Capital + para marcar como feito.'
        : 'Link de ação inválido.';
    return NextResponse.json({ error: message, code: verified.reason.toUpperCase() }, { status: 401, headers });
  }

  const { userId, reminderId, dueDate } = verified.action;
  try {
    await new PostgresRemindersRepository(getDb(), userId).setDone(reminderId, dueDate, true);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers });
    }
    console.error('[lembretes] falha no Realizado da notificação:', err);
    return NextResponse.json({ error: 'Erro no servidor.', code: 'INTERNAL' }, { status: 500, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}
