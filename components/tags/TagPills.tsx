'use client';

import { entryTags, tagColor, type Tag } from '@/lib/budget';

/** An entry's tags as small pills (a dot of the tag's colour and its name), the first `max` and then "+N". */
export function TagPills({
  tagIds,
  tags,
  max = 2,
}: {
  tagIds: readonly string[] | undefined;
  tags: readonly Tag[] | undefined;
  max?: number;
}) {
  const list = entryTags(tagIds, tags);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1 align-middle">
      {shown.map((tag) => (
        <TagPill key={tag.id} tag={tag} />
      ))}
      {rest > 0 && (
        <span className="text-muted text-[11px] font-medium" aria-label={`e mais ${rest} tags`}>
          +{rest}
        </span>
      )}
    </span>
  );
}

export function TagPill({ tag }: { tag: Tag }) {
  return (
    <span className="bg-background text-foreground border-border inline-flex max-w-[10rem] items-center gap-1 rounded-full border px-1.5 py-px text-[11px] leading-4 font-medium">
      <TagDot tag={tag} />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

/** The dot of the tag's colour that stands before its name everywhere. */
export function TagDot({
  tag,
  className = 'h-2 w-2',
}: {
  tag: Pick<Tag, 'color' | 'order'>;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`${className} shrink-0 rounded-full`}
      style={{ background: tagColor(tag) }}
    />
  );
}
