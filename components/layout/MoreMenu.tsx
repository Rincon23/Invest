import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { MoreLayout } from '@/lib/storage/preferences';
import { IconTile, type IconTone } from '@/components/ui/IconTile';

export interface MoreMenuItem {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: IconTone;
  /** Either a page to open or an action to run. */
  href?: string;
  onClick?: () => void;
  /** Unread things in it (Lembretes): a red count on the icon. */
  badge?: number;
}

export interface MoreMenuSection {
  title: string;
  /** Shown above the entries: a card of its own (Missões, in "Seu progresso"). */
  content?: ReactNode;
  items: MoreMenuItem[];
}

/**
 * The app drawer's content: who is signed in, then grouped entries, each with its own icon. Two
 * looks, a button switches between them: `grid`, a phone's app drawer (a big icon with the name
 * under it), and `list`, the settings list of a phone (label, what it is for and a chevron).
 * `onNavigate` runs when an entry that opens a page is tapped. Purely presentational.
 */
export function MoreMenu({
  user,
  sections,
  layout = 'grid',
  onNavigate,
}: {
  user: { name: string | null; email: string | null };
  sections: MoreMenuSection[];
  layout?: MoreLayout;
  onNavigate?: () => void;
}) {
  const displayName = user.name?.trim() || user.email?.split('@')[0] || 'Sua conta';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col gap-5 px-4">
      <Link
        href="/configuracoes"
        onClick={onNavigate}
        className="border-border bg-card hover:border-primary/40 flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition"
      >
        <span
          aria-hidden
          className="bg-primary/15 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold"
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate font-semibold">{displayName}</span>
          {user.email && <span className="text-muted block truncate text-sm">{user.email}</span>}
        </span>
        <ChevronRight aria-hidden className="text-muted h-5 w-5 shrink-0" />
      </Link>

      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-muted px-1 text-xs font-semibold tracking-wide uppercase">
            {section.title}
          </h2>
          {section.content}
          {section.items.length === 0 ? null : layout === 'grid' ? (
            <GridSection items={section.items} onNavigate={onNavigate} />
          ) : (
            <ListSection items={section.items} onNavigate={onNavigate} />
          )}
        </section>
      ))}
    </div>
  );
}

/** The icon of an entry, with the red count of what is unread in it. */
function ItemIcon({ item, size }: { item: MoreMenuItem; size?: 'lg' }) {
  const badge = item.badge ?? 0;
  return (
    <span className="relative shrink-0">
      <IconTile icon={item.icon} tone={item.tone} size={size} />
      {badge > 0 && (
        <span
          aria-hidden
          className="bg-danger ring-card absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ring-2"
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </span>
  );
}

/** What a screen reader hears after the name of an entry with unread things. */
function badgeText(item: MoreMenuItem): string {
  const badge = item.badge ?? 0;
  return badge > 0 ? ` · ${badge} não ${badge === 1 ? 'lida' : 'lidas'}` : '';
}

type SectionProps = { items: MoreMenuItem[]; onNavigate?: () => void };

function ListSection({ items, onNavigate }: SectionProps) {
  return (
    <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-2xl border shadow-sm">
      {items.map((item) => {
        const content = (
          <>
            <ItemIcon item={item} />
            <span className="min-w-0 flex-1 text-left">
              <span className="text-foreground block font-medium">
                {item.label}
                <span className="sr-only">{badgeText(item)}</span>
              </span>
              <span className="text-muted block truncate text-xs">{item.description}</span>
            </span>
            <ChevronRight aria-hidden className="text-muted h-5 w-5 shrink-0" />
          </>
        );
        const className =
          'hover:bg-background flex min-h-[64px] w-full items-center gap-3 px-4 py-3 transition-colors';
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} onClick={onNavigate} className={className}>
                {content}
              </Link>
            ) : (
              <button type="button" onClick={item.onClick} className={className}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GridSection({ items, onNavigate }: SectionProps) {
  return (
    <ul className="grid grid-cols-3 gap-2">
      {items.map((item) => {
        // The description is the accessible name's complement: the tile itself only has room
        // for the label, so the rest goes to the title attribute and to screen readers.
        const content = (
          <>
            <ItemIcon item={item} size="lg" />
            <span className="text-foreground line-clamp-2 w-full text-center text-xs leading-tight font-medium">
              {item.label}
            </span>
            <span className="sr-only">
              {badgeText(item)} · {item.description}
            </span>
          </>
        );
        const className =
          'border-border bg-card hover:border-primary/40 flex min-h-[104px] w-full flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 shadow-sm transition active:scale-[0.97]';
        return (
          <li key={item.key} className="min-w-0">
            {item.href ? (
              <Link href={item.href} onClick={onNavigate} title={item.description} className={className}>
                {content}
              </Link>
            ) : (
              <button type="button" onClick={item.onClick} title={item.description} className={className}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
