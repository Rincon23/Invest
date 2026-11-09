import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { getDb } from '@/lib/server/db';
import { readJson } from '@/lib/server/http';
import { HttpError } from '@/lib/server/httpError';
import { quoteServiceAllowed, quotesFor } from '@/lib/server/quoteService';
import { quoteServiceSchema } from '@/lib/server/validation';

/**
 * The quote service for the Capital + (lib/server/quoteService.ts): only inside the Docker network,
 * with the shared secret. Anything else is "not found", so nobody learns it exists.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!quoteServiceAllowed(request.headers)) {
    return NextResponse.json({ error: 'Não encontrado.', code: 'NOT_FOUND' }, { status: 404 });
  }
  try {
    const { tickers } = await readJson(request, quoteServiceSchema, { maxBytes: 4 * 1024 });
    return NextResponse.json(await quotesFor(getDb(), tickers), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Dados inválidos.', code: 'INVALID_INPUT' }, { status: 400 });
    }
    console.error('[cotações] falha no serviço:', err);
    return NextResponse.json({ error: 'Erro no servidor.', code: 'INTERNAL' }, { status: 500 });
  }
}
