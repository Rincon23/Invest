import { CaixaScreen, type ReserveTab } from '@/components/screens/CaixaScreen';

const TABS: Record<string, ReserveTab> = {
  emergencia: 'emergencia',
  investida: 'investida',
};

export default async function CaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[] }>;
}) {
  const { aba } = await searchParams;
  // "?aba=investida" opens the reserve in quotas (the module's tour and the old /carteira/reserva).
  return <CaixaScreen initialTab={typeof aba === 'string' ? TABS[aba] : undefined} />;
}
