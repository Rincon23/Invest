import { NextResponse, type NextRequest } from 'next/server';
import { PostgresBudgetRepository } from '@/lib/server/budgetRepository';
import { verifyCardBillAction } from '@/lib/server/cardActionToken';
import { getDb } from '@/lib/server/db';
import { HttpError } from '@/lib/server/httpError';
import { PostgresWalletRepository } from '@/lib/server/walletRepository';
import { actionTokenSchema } from '@/lib/server/validation';

/**
 * "Fatura paga ✅" tapped on a bill notification. Called by the service worker, possibly with no
 * session at all: the signed token is the authorization, and it only pays the bill it was
 * issued for.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  const body: unknown = await request.json().catch(() => null);
  const parsed = actionTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.', code: 'INVALID_INPUT' }, { status: 400, headers });
  }

  const verified = verifyCardBillAction(parsed.data.token);
  if (!verified.ok) {
    const message =
      verified.reason === 'expired'
        ? 'Esse aviso expirou. Abra o Capital + para marcar a fatura como paga.'
        : 'Link de ação inválido.';
    return NextResponse.json({ error: message, code: verified.reason.toUpperCase() }, { status: 401, headers });
  }

  const { userId, cardId, month } = verified.action;
  try {
    const db = getDb();
    const wallet = new PostgresWalletRepository(db, userId, new PostgresBudgetRepository(db, userId));
    await wallet.payBill({ cardId, month });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers });
    }
    console.error('[cartões] falha no Fatura paga da notificação:', err);
    return NextResponse.json({ error: 'Erro no servidor.', code: 'INTERNAL' }, { status: 500, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}
