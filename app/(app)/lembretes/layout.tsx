import type { ReactNode } from 'react';
import { RemindersProvider } from '@/components/reminders/RemindersProvider';

export default function LembretesLayout({ children }: { children: ReactNode }) {
  return <RemindersProvider>{children}</RemindersProvider>;
}
