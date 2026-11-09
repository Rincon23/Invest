import { ChartColumn, Landmark, Target, type LucideIcon } from 'lucide-react';
import type { HomeWidgetKey, ModuleKey } from '@/lib/core';
import type { IconTone } from '@/components/ui/IconTile';

export interface ModuleVisual {
  icon: LucideIcon;
  tone: IconTone;
}

/** The icon and colour that identify each module everywhere: the app drawer, the widgets and the module list. */
export const MODULE_VISUALS: Record<ModuleKey, ModuleVisual> = {
  diagram: { icon: Target, tone: 'orange' },
  history: { icon: ChartColumn, tone: 'pink' },
  banks: { icon: Landmark, tone: 'blue' },
};

/** The icon of an Início widget: its module's. */
export function widgetVisual(key: HomeWidgetKey): ModuleVisual {
  return MODULE_VISUALS[key];
}
