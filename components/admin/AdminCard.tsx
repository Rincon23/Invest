import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { IconTile, type IconTone } from '@/components/ui/IconTile';

/** One block of Administração: an icon, a title and what it is about. */
export function AdminCard({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: LucideIcon;
  tone: IconTone;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} tone={tone} size="sm" />
        <h2 className="text-foreground font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
