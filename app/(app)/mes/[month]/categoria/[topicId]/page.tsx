import { CategoryDetailScreen } from '@/components/screens/CategoryDetailScreen';

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ month: string; topicId: string }>;
}) {
  const { topicId } = await params;
  return <CategoryDetailScreen topicId={topicId} />;
}
