import { DiagramaScreen, type DiagramTab } from '@/components/screens/DiagramaScreen';

const TABS: Record<string, DiagramTab> = {
  aporte: 'aporte',
  ativos: 'ativos',
};

export default async function DiagramaPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[]; conferir?: string | string[] }>;
}) {
  const { aba, conferir } = await searchParams;
  // "?aba=ativos" opens that tab (the module's tour walks through both); "&conferir=1" comes from
  // "Conferir investimentos" in Open Finance and shows only what differs from the banks.
  return (
    <DiagramaScreen
      initialTab={typeof aba === 'string' ? TABS[aba] : undefined}
      checkBanks={conferir === '1'}
    />
  );
}
