/**
 * Hostnames the app is served from behind a reverse proxy / tunnel (Cloudflare, Tailscale…),
 * from APP_ALLOWED_ORIGINS: comma-separated, no scheme. Example: capital.exemplo.com
 */
export function allowedOriginHosts(): string[] {
  return (process.env.APP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
