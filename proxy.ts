import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { clientIp } from './lib/server/clientIp';
import { admitRequest, type Verdict } from './lib/server/loadGuard';

// Next.js 16: the file formerly known as `middleware.ts`. Two jobs, in this order:
//
// 1. The load guard (lib/server/loadGuard.ts): an address flooding the server is turned away,
//    and past the critical point (too many requests per second, or the board too hot) every
//    request is, for a while — so the Orange Pi neither falls over nor overheats.
// 2. An optimistic gate: it checks that a session cookie exists. Whether the session is actually
//    valid is checked by the authenticated layout (pages) and by every /api/v1 route.

/**
 * Path prefixes reachable without a session. The notification actions carry their own signed
 * token instead (lib/server/reminderActionToken.ts, lib/server/cardActionToken.ts).
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/auth',
  '/redefinir-senha',
  // The privacy policy linked from Google's consent screen.
  '/privacidade',
  '/api/auth',
  '/api/v1/reminders/actions',
  '/api/v1/wallet/cards/actions',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const BUSY_PAGE = (title: string, message: string, retryAfter: number) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${retryAfter}">
<title>Capital + — volte em instantes</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f4f6; --card: #ffffff; --fg: #18181b; --muted: #71717a; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0b0d; --card: #18181b; --fg: #f4f4f5; --muted: #a1a1aa; } }
  body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 360px; background: var(--card); border-radius: 16px; padding: 24px; text-align: center;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); }
  h1 { font-size: 18px; margin: 8px 0; }
  p { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0; }
  .icon { font-size: 32px; }
</style>
</head>
<body>
<main>
  <div class="icon" aria-hidden="true">⏳</div>
  <h1>${title}</h1>
  <p>${message}</p>
</main>
</body>
</html>`;

/** What a turned-away request gets: JSON for the API (the app shows the message), a page otherwise. */
function busyResponse(request: NextRequest, verdict: Exclude<Verdict, { action: 'allow' }>): Response {
  const retryAfter = verdict.retryAfterSeconds;
  const blocked = verdict.action === 'block-ip';
  const status = blocked ? 429 : 503;
  const headers = { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' };
  const message = blocked
    ? `Muitos acessos seguidos deste aparelho. Espere ${retryAfter} segundos e tente de novo.`
    : `O Capital + recebeu acessos demais de uma vez e pausou por alguns instantes para não cair. Tente de novo em ${retryAfter} segundos.`;

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: message, code: blocked ? 'RATE_LIMITED' : 'SERVER_BUSY' },
      { status, headers },
    );
  }
  const title = blocked ? 'Muitos acessos seguidos' : 'O Capital + está descansando um pouquinho';
  return new NextResponse(BUSY_PAGE(title, message, retryAfter), {
    status,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function proxy(request: NextRequest) {
  const verdict = admitRequest(clientIp(request.headers));
  if (verdict.action !== 'allow') return busyResponse(request, verdict);

  const { pathname } = request.nextUrl;
  if (isPublic(pathname) || getSessionCookie(request)) return NextResponse.next();

  // The API answers in JSON; the HTTP repository turns this into "go to /login".
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Sessão expirada. Entre novamente para continuar.', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Every request path except:
     * - _next/static, _next/image (build assets)
     * - PWA / metadata files served as-is (manifest, service worker, offline page, icons)
     * - any image file
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline.html|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',
  ],
};
