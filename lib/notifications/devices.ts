/**
 * A short name for the device behind a push subscription, from its User-Agent, so the list
 * in Settings reads "Chrome no Android" instead of a push-service URL. The order of the checks
 * matters: Edge, Opera and Samsung Internet also say "Chrome", and every iOS browser says
 * "Safari".
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Aparelho desconhecido';
  const ua = userAgent;

  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Navegador';

  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'Chromebook'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X|Macintosh/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  return system ? `${browser} no ${system}` : browser;
}
