import { OPEN_APPS_PARAM } from '@/lib/modules';
import { DashboardScreen } from '@/components/screens/DashboardScreen';

export default async function MonthDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // "?apps=1" (what an old link to /mais becomes) opens the app drawer straight away.
  return <DashboardScreen openApps={params[OPEN_APPS_PARAM] !== undefined} />;
}
