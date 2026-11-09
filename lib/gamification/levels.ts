/**
 * The levels of the XP, each with a name that gets better as it grows. The names are of a tree
 * growing, like the money: the app does not know the person's gender, so a name of a person
 * ("Organizado", "Poupador") would be wrong for half of them.
 *
 * The curve makes the first levels quick (doing the first missions reaches Arbusto in the first
 * month) and then follows the months of use: about 420 XP a month for someone who opens the app
 * almost every day and does the month's missions, so Floresta takes almost two years.
 */
export const LEVELS: readonly { name: string; xp: number }[] = [
  { name: 'Semente', xp: 0 },
  { name: 'Broto', xp: 150 },
  { name: 'Muda', xp: 400 },
  { name: 'Arbusto', xp: 800 },
  { name: 'Árvore', xp: 1400 },
  { name: 'Árvore florida', xp: 2200 },
  { name: 'Árvore com frutos', xp: 3300 },
  { name: 'Pomar', xp: 4800 },
  { name: 'Bosque', xp: 6800 },
  { name: 'Floresta', xp: 9500 },
];

export interface LevelProgress {
  /** 1 to `LEVELS.length`. */
  level: number;
  name: string;
  xp: number;
  /** The XP this level starts at. */
  floor: number;
  /** The XP of the next level; null at the last one. */
  next: number | null;
  /** How far into this level, 0..1 (1 at the last level). */
  progress: number;
}

export function levelOf(xp: number): LevelProgress {
  const total = Math.max(0, Math.floor(xp));
  let index = 0;
  while (index + 1 < LEVELS.length && total >= LEVELS[index + 1].xp) index += 1;
  const floor = LEVELS[index].xp;
  const next = LEVELS[index + 1]?.xp ?? null;
  return {
    level: index + 1,
    name: LEVELS[index].name,
    xp: total,
    floor,
    next,
    progress: next === null ? 1 : (total - floor) / (next - floor),
  };
}
