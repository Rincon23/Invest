import { z } from 'zod';
import { effectiveModules } from '@/lib/modules';
import { factOfDay } from '@/lib/motivation';
import { zonedToday } from '@/lib/reminders';
import { getDb } from '@/lib/server/db';
import { listFacts } from '@/lib/server/factsRepository';
import { isHomeTemplateEmail } from '@/lib/server/homeTemplate';
import { apiRoute, readJson } from '@/lib/server/http';
import { PostgresMissionsRepository } from '@/lib/server/missionsRepository';

/** The places the app says the person just went to (`visitsForPath`), for the missions done by going. */
const checkSchema = z.object({ visits: z.array(z.string().max(40)).max(20).optional() });

/**
 * Gives the XP of what the account just did and returns its missions, level and XP, with the "Você
 * sabia?" of today. The Início template earns nothing: it is a tool of the owner's, not a person.
 */
export const POST = apiRoute(async ({ request, userId, email, access }) => {
  const { visits } = await readJson(request, checkSchema);
  const moduleAccess = await access();
  const db = getDb();
  const [status, facts] = await Promise.all([
    new PostgresMissionsRepository(db, userId).check({
      modules: effectiveModules(moduleAccess),
      restricted: moduleAccess.vipModules,
      visits,
      record: !isHomeTemplateEmail(email),
    }),
    listFacts(db),
  ]);
  return { ...status, fact: factOfDay(facts, zonedToday()) };
});
