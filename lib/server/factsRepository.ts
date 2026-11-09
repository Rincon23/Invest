import { asc, eq, max } from 'drizzle-orm';
import { createId } from '../budget/id';
import { DEFAULT_FACTS, type FactInput, type InvestingFact } from '../motivation';
import { investingFacts } from './db/schema';
import type { Database } from './db/types';
import { HttpError } from './httpError';

/** The "Você sabia?" of everyone (`lib/motivation`): read by the app, written in Administração. */

const COLUMNS = {
  id: investingFacts.id,
  text: investingFacts.text,
  detail: investingFacts.detail,
  sourceLabel: investingFacts.sourceLabel,
  sourceUrl: investingFacts.sourceUrl,
};

function readFacts(db: Database): Promise<InvestingFact[]> {
  return db.select(COLUMNS).from(investingFacts).orderBy(asc(investingFacts.position), asc(investingFacts.id));
}

/** Every fact in order. An empty table is one that never had any: it gets the default ones. */
export async function listFacts(db: Database): Promise<InvestingFact[]> {
  const facts = await readFacts(db);
  if (facts.length > 0) return facts;
  await db
    .insert(investingFacts)
    .values(DEFAULT_FACTS.map((fact, position) => ({ ...fact, position })))
    .onConflictDoNothing();
  return readFacts(db);
}

export async function createFact(db: Database, input: FactInput): Promise<InvestingFact> {
  // First, or this one would stop the default facts from ever coming in.
  await listFacts(db);
  const [{ last }] = await db.select({ last: max(investingFacts.position) }).from(investingFacts);
  const [fact] = await db
    .insert(investingFacts)
    .values({ id: createId(), position: (last ?? -1) + 1, ...input })
    .returning(COLUMNS);
  return fact;
}

export async function updateFact(db: Database, id: string, input: FactInput): Promise<InvestingFact> {
  const [fact] = await db
    .update(investingFacts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(investingFacts.id, id))
    .returning(COLUMNS);
  if (!fact) throw new HttpError(404, 'NOT_FOUND', 'Frase não encontrada.');
  return fact;
}

/** The last one stays: without any, the table would look new and the default ones would come back. */
export async function deleteFact(db: Database, id: string): Promise<void> {
  const facts = await readFacts(db);
  if (!facts.some((fact) => fact.id === id)) throw new HttpError(404, 'NOT_FOUND', 'Frase não encontrada.');
  if (facts.length === 1) throw new HttpError(409, 'LAST_FACT', 'Deixe pelo menos uma frase.');
  await db.delete(investingFacts).where(eq(investingFacts.id, id));
}
