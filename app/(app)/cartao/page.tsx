import { CartaoScreen, type CardTab } from '@/components/screens/CartaoScreen';

const TABS: Record<string, CardTab> = {
  fatura: 'fatura',
  parcelados: 'parcelados',
  cartoes: 'cartoes',
};

export default async function CartaoPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[] }>;
}) {
  const { aba } = await searchParams;
  // "?aba=parcelados" opens that tab (the module's tour walks through all three).
  return <CartaoScreen initialTab={typeof aba === 'string' ? TABS[aba] : undefined} />;
}
