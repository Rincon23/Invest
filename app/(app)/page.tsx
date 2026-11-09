import { OPEN_APPS_PARAM } from '@/lib/modules';
import { DashboardScreen } from '@/components/screens/DashboardScreen';

/** "/" is the Início: the áreas de trabalho of widgets and the up-arrow to every app. */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // "?apps=1" opens the app drawer straight away.
  return <DashboardScreen openApps={params[OPEN_APPS_PARAM] !== undefined} />;
}
