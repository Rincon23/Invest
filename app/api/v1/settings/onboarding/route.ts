import { apiRoute } from '@/lib/server/http';

export const POST = apiRoute(async ({ repo }) => {
  await repo.completeOnboarding();
});
