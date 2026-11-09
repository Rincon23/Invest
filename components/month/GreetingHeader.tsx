'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { firstName } from '@/lib/auth/names';
import { greetingFor } from '@/lib/budget';

/**
 * Time-of-day greeting at the top of the home screen ("☀️ Bom dia, Enzo"): the person's first
 * name only, and only when the account has a real one (`realName` keeps the start of the e-mail
 * out of here). Rendered only after mount: the greeting depends on the clock, so rendering it on
 * the server could hydrate into a different one.
 */
export function GreetingHeader() {
  const { user } = useAuth();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);

  if (!now) return null;

  const { emoji, text } = greetingFor(now);
  const name = firstName(user.name);
  return (
    <p className="text-foreground text-base font-semibold">
      <span aria-hidden>{emoji} </span>
      {name ? `${text}, ${name}` : text}
    </p>
  );
}
