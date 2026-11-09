// @vitest-environment node
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FACTS } from '../../motivation';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { createFact, deleteFact, listFacts, updateFact } from '../factsRepository';
import { factSchema } from '../validation';

const NEW_FACT = { text: 'Sabia que?', detail: 'Explicação.', sourceLabel: 'Fonte', sourceUrl: null };

let db: Database;

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

describe('frases do "Você sabia?"', () => {
  it('começam com as frases de partida, na ordem, uma vez só', async () => {
    expect(await listFacts(db)).toEqual(DEFAULT_FACTS);
    expect(await listFacts(db)).toEqual(DEFAULT_FACTS);
  });

  it('criar a primeira não impede as de partida de entrar', async () => {
    const fact = await createFact(db, NEW_FACT);

    const facts = await listFacts(db);
    expect(facts).toHaveLength(DEFAULT_FACTS.length + 1);
    expect(facts.at(-1)).toEqual(fact);
  });

  it('editar troca o texto e mantém o lugar', async () => {
    const [first] = await listFacts(db);

    await updateFact(db, first.id, { ...NEW_FACT, sourceUrl: 'https://exemplo.com.br' });

    const [edited] = await listFacts(db);
    expect(edited).toEqual({ id: first.id, ...NEW_FACT, sourceUrl: 'https://exemplo.com.br' });
  });

  it('uma frase excluída não volta', async () => {
    const [first] = await listFacts(db);

    await deleteFact(db, first.id);

    const facts = await listFacts(db);
    expect(facts).toHaveLength(DEFAULT_FACTS.length - 1);
    expect(facts.some((fact) => fact.id === first.id)).toBe(false);
  });

  it('a última não pode ser excluída', async () => {
    const facts = await listFacts(db);
    for (const fact of facts.slice(1)) await deleteFact(db, fact.id);

    await expect(deleteFact(db, facts[0].id)).rejects.toMatchObject({ status: 409, code: 'LAST_FACT' });
    expect(await listFacts(db)).toEqual([facts[0]]);
  });

  it('dá 404 para uma frase que não existe', async () => {
    await listFacts(db);
    await expect(updateFact(db, 'nao-existe', NEW_FACT)).rejects.toMatchObject({ status: 404 });
    await expect(deleteFact(db, 'nao-existe')).rejects.toMatchObject({ status: 404 });
  });
});

describe('factSchema', () => {
  it('aceita um link https ou nenhum, e tira espaços', () => {
    expect(factSchema.parse({ ...NEW_FACT, text: '  Oi  ' }).text).toBe('Oi');
    expect(factSchema.parse({ ...NEW_FACT, sourceUrl: 'https://fgc.org.br/x' }).sourceUrl).toBe(
      'https://fgc.org.br/x',
    );
  });

  it('recusa link que não seja https, e frase em branco', () => {
    expect(factSchema.safeParse({ ...NEW_FACT, sourceUrl: 'http://fgc.org.br' }).success).toBe(false);
    expect(factSchema.safeParse({ ...NEW_FACT, sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(factSchema.safeParse({ ...NEW_FACT, text: '   ' }).success).toBe(false);
  });
});
