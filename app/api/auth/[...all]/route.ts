import { getAuth } from '@/lib/server/auth';

/**
 * Better Auth's own HTTP endpoints. The app signs in, signs up, resets passwords and signs out
 * through Server Actions (lib/auth/actions.ts), which call Better Auth on the server and carry
 * their own rate limits. Over HTTP only the links in the e-mails are needed: confirming the
 * address and opening a reset link (plus the error page they may land on). Everything else is
 * closed, so none of it can be scripted around those limits.
 */
const OPEN_GET_PATHS = [/^\/verify-email$/, /^\/reset-password\/[^/]+$/, /^\/error$/];
const BASE_PATH = '/api/auth';

function notFound(): Response {
  return Response.json({ error: 'Não encontrado.', code: 'NOT_FOUND' }, { status: 404 });
}

export async function GET(request: Request) {
  const path = new URL(request.url).pathname.slice(BASE_PATH.length);
  if (!OPEN_GET_PATHS.some((pattern) => pattern.test(path))) return notFound();
  return getAuth().handler(request);
}

export async function POST() {
  return notFound();
}
