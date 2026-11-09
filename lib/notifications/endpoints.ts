/**
 * The push services browsers actually hand out subscriptions for. The server POSTs every
 * notification to the endpoint a browser registered, so an endpoint anywhere else would turn the
 * server into a relay: anyone could make it send requests to a site of their choosing (and learn
 * the server's real IP, which the Cloudflare tunnel otherwise hides). Only these hosts are
 * accepted, and only over https.
 */
const EXACT_HOSTS = new Set([
  // Chrome, Edge on Android, Samsung Internet, Opera, Brave
  'fcm.googleapis.com',
  // Firefox
  'updates.push.services.mozilla.com',
  // Safari (macOS and iOS)
  'web.push.apple.com',
]);

/** Hosts where the push service uses many numbered servers. */
const HOST_SUFFIXES = [
  // Firefox's other servers
  '.push.services.mozilla.com',
  // Edge on Windows (wns2-xxx.notify.windows.com)
  '.notify.windows.com',
  // Safari's other servers
  '.push.apple.com',
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
