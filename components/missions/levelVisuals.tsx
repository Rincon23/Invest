import { createElement } from 'react';
import { Apple, Bean, Flower2, Shrub, Sprout, TreeDeciduous, TreePine, Trees, type LucideIcon } from 'lucide-react';

/** The picture of each level, the tree growing with its name (lib/gamification/levels.ts). */
const LEVEL_ICONS: LucideIcon[] = [Bean, Sprout, Sprout, Shrub, TreeDeciduous, Flower2, Apple, Trees, Trees, TreePine];

/** The tree of `level`. */
export function LevelIcon({ level, className }: { level: number; className?: string }) {
  const icon = LEVEL_ICONS[Math.min(Math.max(level, 1), LEVEL_ICONS.length) - 1];
  return createElement(icon, { 'aria-hidden': true, className });
}
