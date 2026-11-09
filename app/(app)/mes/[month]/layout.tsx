import type { ReactNode } from 'react';
import { MonthShell } from '@/components/month/MonthShell';

export default async function MonthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ month: string }>;
}) {
  const { month } = await params;
  return <MonthShell month={month}>{children}</MonthShell>;
}
