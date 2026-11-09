/**
 * The visitor's IP, for rate limiting. Behind the Cloudflare tunnel, `cf-connecting-ip` is set by
 * Cloudflare itself and cannot be forged — as long as the app's port is reachable only through the
 * tunnel (docker-compose.yml binds it to 127.0.0.1). `X-Forwarded-For` is never trusted: anyone
 * can send one. TRUSTED_IP_HEADER names another header for a different proxy (Tailscale Funnel,
 * nginx). Without the header (local development) the IP is unknown: 'local'.
 */
export const UNKNOWN_IP = 'local';

export function clientIp(headers: Headers): string {
  const header = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase() || 'cf-connecting-ip';
  const value = headers.get(header)?.split(',')[0]?.trim();
  return value ? value.slice(0, 64) : UNKNOWN_IP;
}
