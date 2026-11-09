import { apiRoute } from '@/lib/server/http';

export const POST = apiRoute(async ({ settings }) => {
  await settings.completeOnboarding();
});
