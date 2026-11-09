import { LembretesScreen, type LembretesTab } from '@/components/screens/LembretesScreen';

const TABS: LembretesTab[] = ['hoje', 'todos', 'calendario'];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[]; dia?: string | string[] }>;
}) {
  const { aba, dia } = await searchParams;
  // "?aba=calendario" opens that tab (the Calendário widget on Início links there), and
  // "&dia=2026-10-12" already shows what is on that day.
  const tab = TABS.find((key) => key === aba);
  const day = typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : undefined;
  return <LembretesScreen initialTab={tab} initialDay={tab === 'calendario' ? day : undefined} />;
}
