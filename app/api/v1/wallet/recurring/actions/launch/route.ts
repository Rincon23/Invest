import { NextResponse, type NextRequest } from 'next/server';
import { zonedMoment } from '@/lib/reminders';
import { PostgresBudgetRepository } from '@/lib/server/budgetRepository';
import { getDb } from '@/lib/server/db';
import { HttpError } from '@/lib/server/httpError';
import { verifyRecurringLaunch } from '@/lib/server/recurringActionToken';
import { PostgresWalletRepository } from '@/lib/server/walletRepository';
import { actionTokenSchema } from '@/lib/server/validation';

/**
 * "Lançar ✅" tapped on the notice of a bill of "Contas do mês". Called by the service worker,
 * possibly with no session at all: the signed token is the authorization, and it only launches
 * the bill it was issued for, in the competence of the notice, dated today.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  const body: unknown = await request.json().catch(() => null);
  const parsed = actionTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.', code: 'INVALID_INPUT' }, { status: 400, headers });
  }

  const verified = verifyRecurringLaunch(parsed.data.token);
  if (!verified.ok) {
    const message =
      verified.reason === 'expired'
        ? 'Esse aviso expirou. Abra o Capital + para lançar a conta.'
        : 'Link de ação inválido.';
    return NextResponse.json({ error: message, code: verified.reason.toUpperCase() }, { status: 401, headers });
  }

  const { userId, recurringId, month } = verified.action;
  try {
    const db = getDb();
    const wallet = new PostgresWalletRepository(db, userId, new PostgresBudgetRepository(db, userId));
    await wallet.launchRecurring(recurringId, month, zonedMoment(new Date()).date);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers });
    }
    console.error('[contas do mês] falha no Lançar da notificação:', err);
    return NextResponse.json({ error: 'Erro no servidor.', code: 'INTERNAL' }, { status: 500, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}
