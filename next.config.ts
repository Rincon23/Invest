import type { NextConfig } from 'next';

/** Comma-separated values from the env, trimmed, empties dropped. */
function listEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const isDev = process.env.NODE_ENV === 'development';

/** Comma-separated hostnames the app is served from behind a reverse proxy / tunnel
 *  (Tailscale, Cloudflare, nginx…). Needed so Server Actions (login, etc.) aren't
 *  rejected by Next's CSRF check when the request Origin differs from the local Host.
 *  Example: APP_ALLOWED_ORIGINS=capital.my-tailnet.ts.net,capital.exemplo.com */
const allowedOrigins = listEnv('APP_ALLOWED_ORIGINS');

/**
 * What the browser may load and run. Everything the app uses is its own (the fonts are
 * self-hosted by next/font), so the rules can be strict: no other site can embed the app in a
 * frame (a click on "Apagar tudo" can't be tricked out of anyone), and even an injected script
 * couldn't send data anywhere but back to this server. Next's inline bootstrap scripts need
 * 'unsafe-inline'; the dev server also needs eval and its websocket.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The microphone is only for "Lançar por voz"; nothing else is ever asked for.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // HTTPS only from the first visit on (browsers ignore it over plain http, as in development).
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]),
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for `docker` / bare Node deploys (see README "Publicar").
  output: 'standalone',
  // The app uses no <Image> components; skip the optimizer (and its `sharp` dependency).
  images: { unoptimized: true },
  // No "X-Powered-By: Next.js": nothing tells a scanner which framework (and version) to try.
  poweredByHeader: false,
  // Devices testing the dev server over the LAN / VPN mesh (Tailscale, Radmin, …), from
  // DEV_ALLOWED_ORIGINS (comma-separated hosts/IPs). Dev-only.
  allowedDevOrigins: listEnv('DEV_ALLOWED_ORIGINS'),
  experimental: {
    serverActions: { allowedOrigins },
    // `proxy.ts` buffers each request body up to this size; the largest legitimate one is a
    // backup (the backup route itself refuses more than 8 MB, the others far less).
    proxyClientMaxBodySize: '8mb',
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
