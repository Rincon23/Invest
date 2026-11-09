/**
 * "há 5 min", "há 5 h", "ontem", "há 3 dias": how long ago a bank last sent data. Never "agora":
 * the data comes once a day, and the words must not promise more.
 */
export function formatAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'há menos de 1 min';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}
