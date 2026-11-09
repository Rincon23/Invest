'use client';

import { homeHref } from '@/lib/modules';

/** Where a screen's back arrow goes: the Início, like closing an app on a phone lands on the home screen. */
export function useHomeHref(): string {
  return homeHref();
}
