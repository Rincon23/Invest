// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { factOfWeek } from '../../motivation';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { listFacts, updateFact } from '../factsRepository';
import { runMotivationJob } from '../motivation';
import { PostgresNotificationsRepository } from '../notificationsRepository';
import type { PushSender } from '../push';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

/** An instant in São Paulo (UTC−3). */
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

async function account({ device = true, prefs = {} } = {}) {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  await db
    .insert(schema.budgetSettings)
    .values({
      userId: id,
      topics: [],
      specialCategories: { fixedCost: 'Custos Fixos', unforeseen: 'Imprevistos' },
      notificationPrefs: prefs,
    });
  if (device) {
    await db.insert(schema.pushSubscriptions).values({
      userId: id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
      p256dh: 'chave',
      auth: 'segredo',
    });
  }
  return { id, feed: new PostgresNotificationsRepository(db, id) };
}

const fakeSender = () => vi.fn<PushSender>(async () => {});

describe('frase da semana', () => {
  it('chega na segunda às 9h, com a frase da semana, uma vez só', async () => {
    const { feed } = await account();
    const sender = fakeSender();

    expect((await runMotivationJob(db, at('2026-11-02', '09:00'), sender)).notified).toBe(1);
    expect((await runMotivationJob(db, at('2026-11-02', '09:01'), sender)).notified).toBe(0);

    expect(sender).toHaveBeenCalledTimes(1);
    const [payload] = sender.mock.calls[0].slice(1);
    expect(JSON.parse(payload as string)).toMatchObject({
      title: '💡 Você sabia?',
      body: factOfWeek(await listFacts(db), '2026-11-02').text,
      url: '/',
    });
    expect((await feed.list()).notifications.map((item) => item.category)).toEqual(['motivation']);
  });

  it('manda a frase como o dono deixou', async () => {
    await account();
    const sender = fakeSender();
    const fact = factOfWeek(await listFacts(db), '2026-12-14');
    await updateFact(db, fact.id, { ...fact, text: 'Frase editada pelo dono' });

    await runMotivationJob(db, at('2026-12-14', '09:00'), sender);

    const [payload] = sender.mock.calls[0].slice(1);
    expect(JSON.parse(payload as string).body).toBe('Frase editada pelo dono');
  });

  it('não sai em outro dia nem fora do horário', async () => {
    await account();
    const sender = fakeSender();

    await runMotivationJob(db, at('2026-11-09', '08:59'), sender);
    await runMotivationJob(db, at('2026-11-09', '21:00'), sender);
    await runMotivationJob(db, at('2026-11-10', '09:00'), sender);

    expect(sender).not.toHaveBeenCalled();
  });

  it('sai mais tarde no mesmo dia se o servidor estava desligado às 9h', async () => {
    await account();
    const sender = fakeSender();

    await runMotivationJob(db, at('2026-11-16', '14:30'), sender);

    expect(sender).toHaveBeenCalled();
  });

  it('não vai para quem não tem aparelho nem aparece no sino dessa pessoa', async () => {
    const { feed } = await account({ device: false });

    await runMotivationJob(db, at('2026-11-23', '09:00'), fakeSender());

    expect((await feed.list()).notifications).toHaveLength(0);
  });

  it('quem desligou não recebe no celular nem no sino', async () => {
    const { id, feed } = await account({ prefs: { motivation: false } });
    const sender = fakeSender();

    await runMotivationJob(db, at('2026-11-30', '09:00'), sender);

    const endpoints = sender.mock.calls.map(([subscription]) => subscription.endpoint);
    expect(endpoints.some((endpoint) => endpoint.includes(id))).toBe(false);
    expect((await feed.list()).notifications).toHaveLength(0);
  });

  it('não repete para quem já recebeu se a rodada foi interrompida e voltou', async () => {
    const { id, feed } = await account();
    const sender = fakeSender();
    await runMotivationJob(db, at('2026-12-07', '09:00'), sender);
    await db.delete(schema.jobRuns).where(eq(schema.jobRuns.name, 'motivation'));

    await runMotivationJob(db, at('2026-12-07', '09:01'), sender);

    const endpoints = sender.mock.calls.map(([subscription]) => subscription.endpoint);
    expect(endpoints.filter((endpoint) => endpoint.includes(id))).toHaveLength(1);
    expect((await feed.list()).notifications).toHaveLength(1);
  });
});
