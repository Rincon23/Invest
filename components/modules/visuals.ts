import {
  CalendarDays,
  ChartColumn,
  ChartPie,
  Clock,
  CreditCard,
  HandCoins,
  Landmark,
  PiggyBank,
  Target,
  ReceiptText,
  Repeat,
  Sprout,
  type LucideIcon,
} from 'lucide-react';
import type { HomeWidgetKey, ModuleKey } from '@/lib/budget';
import type { IconTone } from '@/components/ui/IconTile';

export interface ModuleVisual {
  icon: LucideIcon;
  tone: IconTone;
}

/** The icon and colour that identify each module everywhere: the app drawer, the widgets and the module list. */
export const MODULE_VISUALS: Record<ModuleKey, ModuleVisual> = {
  expenses: { icon: ReceiptText, tone: 'blue' },
  budget: { icon: ChartPie, tone: 'purple' },
  card: { icon: CreditCard, tone: 'orange' },
  reimbursable: { icon: HandCoins, tone: 'green' },
  history: { icon: ChartColumn, tone: 'pink' },
  recurring: { icon: Repeat, tone: 'blue' },
  cash: { icon: PiggyBank, tone: 'green' },
  diagram: { icon: Target, tone: 'orange' },
  reminders: { icon: Clock, tone: 'amber' },
  banks: { icon: Landmark, tone: 'blue' },
  missions: { icon: Sprout, tone: 'green' },
};

/** The icon of an Início widget: its module's, except for the extra widgets, which have their own. */
export function widgetVisual(key: HomeWidgetKey): ModuleVisual {
  if (key === 'calendar') return { icon: CalendarDays, tone: 'blue' };
  return MODULE_VISUALS[key];
}
