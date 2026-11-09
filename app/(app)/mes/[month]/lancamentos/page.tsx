import { LancamentosScreen } from '@/components/screens/LancamentosScreen';

export default async function LancamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[]; tags?: string | string[] }>;
}) {
  const { aba, tags } = await searchParams;
  // "?aba=a-receber" opens the list already filtered to "A receber" (the card on Início links there);
  // "?tags=a,b" keeps the tags chosen when the month changes.
  const initialTags =
    typeof tags === 'string' && tags ? tags.split(',').filter(Boolean).slice(0, 20) : undefined;
  return (
    <LancamentosScreen
      initialFilter={aba === 'a-receber' ? 'reimbursable' : undefined}
      initialTags={initialTags}
    />
  );
}
