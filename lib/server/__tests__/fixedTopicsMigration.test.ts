// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOPICS, computeMonthSummary, type MonthData, type TopicConfig } from '@/lib/budget';
import { BACKUP_VERSION } from '@/lib/storage/repository';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { FIXED_TOPICS_JOB, runFixedTopicsMigration } from '../fixedTopicsMigration';

/**
 * The four fixed categories reach the accounts that already exist: "Diversos" becomes
 * "Prazeres e Confortos" and a category the person created folds into it, with everything that
 * pointed at it, without changing what the months add up to.
 */

let db: Database;

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

/** An account as it was before: "Diversos" by its old name and "Pets", created by the person. */
async function oldAccount() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  const repo = new PostgresBudgetRepository(db, id);
  const seeded = (await repo.getSettings()).topics;
  const [diversos] = seeded;
  const topics: TopicConfig[] = [
    { ...diversos, name: 'Diversos', description: 'Os prazeres e confortos da vida.', targetPct: 0.1 },
    ...seeded.slice(1),
    { id: 'pets', name: 'Pets', description: 'Ração', targetPct: 0.1, order: 4, color: '#ff0000' },
  ];
  await db
    .update(schema.budgetSettings)
    .set({ topics, quickCategories: ['topic:pets', 'fixedCost'] })
    .where(eq(schema.budgetSettings.userId, id));
  return { id, repo, diversos: diversos.id };
}

const expense = (id: string, topicId: string, amount: number, date: string) => ({
  id,
  categoryKind: 'topic' as const,
  topicId,
  description: id,
  amount,
  date,
});

/** January closed passing its leftovers to February, both with money in "Pets". */
async function withMonths(repo: PostgresBudgetRepository, diversos: string) {
  await repo.saveIncome('2026-01', { id: 'sal-1', source: 'Salário', amount: 1000, date: '2026-01-05' });
  await repo.saveIncome('2026-01', {
    id: 'bico',
    source: 'Bico',
    amount: 200,
    date: '2026-01-06',
    topicId: 'pets',
  });
  await repo.saveExpense('2026-01', expense('racao', 'pets', 70, '2026-01-10'));
  await repo.saveExpense('2026-01', expense('cinema', diversos, 40, '2026-01-11'));
  await repo.saveExpense('2026-01', {
    id: 'luz',
    categoryKind: 'fixedCost',
    description: 'Luz',
    amount: 100,
    date: '2026-01-02',
  });
  await repo.closeMonth('2026-01', true);
  await repo.saveIncome('2026-02', { id: 'sal-2', source: 'Salário', amount: 1000, date: '2026-02-05' });
  await repo.saveExpense('2026-02', expense('vet', 'pets', 150, '2026-02-12'));
}

/** What a month adds up to: the totals and the sum over the categories that remain. */
function totals(data: MonthData, topics: TopicConfig[]) {
  const summary = computeMonthSummary(data, topics);
  return {
    income: summary.incomeTotal,
    spent: summary.expenseTotal,
    available: Math.round(summary.availableTotal * 100) / 100,
    remaining: Math.round(summary.topics.reduce((total, t) => total + t.remaining, 0) * 100) / 100,
  };
}

describe('as quatro categorias fixas nas contas que já existem', () => {
  it('renomeia Diversos e junta a criada a Prazeres e Confortos, sem mudar o que os meses somam', async () => {
    const { id, repo, diversos } = await oldAccount();
    await withMonths(repo, diversos);
    await db.insert(schema.recurringExpenses).values({
      userId: id,
      id: 'r1',
      categoryKind: 'topic',
      topicId: 'pets',
      description: 'Ração do mês',
      amount: 90,
      card: false,
      position: 0,
    });
    await db.insert(schema.installments).values({
      userId: id,
      id: 'p1',
      name: 'Casinha',
      categoryKind: 'topic',
      topicId: 'pets',
      firstDebitDate: '2026-05-10',
      count: 2,
      totalAmount: 200,
      accounting: 'installment',
    });
    await db
      .insert(schema.investmentBuckets)
      .values({ userId: id, id: 'b1', name: 'Pets', topicId: 'pets', position: 0 });
    await db
      .insert(schema.bankCategoryMemory)
      .values({ userId: id, key: 'petshop', categoryKind: 'topic', topicId: 'pets' });

    const settingsBefore = (await repo.getSettings()).topics;
    const before = await Promise.all(
      ['2026-01', '2026-02'].map(async (month) => totals((await repo.getMonth(month))!, settingsBefore)),
    );

    const result = await runFixedTopicsMigration(db);
    expect(result).toMatchObject({ skipped: false, topics: 1 });
    // 2 expenses, 1 income, the template, the plan, the bucket and the bank memory.
    expect(result.entries).toBe(7);

    const settings = await repo.getSettings();
    expect(settings.topics.map((t) => t.name)).toEqual(DEFAULT_TOPICS.map((t) => t.name));
    expect(settings.topics[0]).toMatchObject({
      id: diversos,
      description: DEFAULT_TOPICS[0].description,
      targetPct: 0.2,
    });
    expect(settings.quickCategories).toEqual([`topic:${diversos}`, 'fixedCost']);

    const january = (await repo.getMonth('2026-01'))!;
    const february = (await repo.getMonth('2026-02'))!;
    for (const data of [january, february]) {
      expect(data.topicsSnapshot.map((t) => t.id)).not.toContain('pets');
      expect(data.topicsSnapshot.find((t) => t.id === diversos)?.name).toBe('Prazeres e Confortos');
      expect(Object.keys(data.carryIn)).not.toContain('pets');
      expect(data.expenses.every((e) => e.topicId !== 'pets')).toBe(true);
    }
    expect(january.incomes.find((i) => i.id === 'bico')?.topicId).toBe(diversos);
    expect(february.expenses.find((e) => e.id === 'vet')?.topicId).toBe(diversos);

    expect([totals(january, settings.topics), totals(february, settings.topics)]).toEqual(before);

    const [template] = await db
      .select()
      .from(schema.recurringExpenses)
      .where(eq(schema.recurringExpenses.userId, id));
    const [plan] = await db.select().from(schema.installments).where(eq(schema.installments.userId, id));
    const [bucket] = await db
      .select()
      .from(schema.investmentBuckets)
      .where(eq(schema.investmentBuckets.userId, id));
    const [memory] = await db
      .select()
      .from(schema.bankCategoryMemory)
      .where(eq(schema.bankCategoryMemory.userId, id));
    expect([template.topicId, plan.topicId, bucket.topicId, memory.topicId]).toEqual([
      diversos,
      diversos,
      diversos,
      diversos,
    ]);
  });

  it('roda uma vez só, e aplicar de novo não muda nada', async () => {
    const { repo, diversos } = await oldAccount();
    await withMonths(repo, diversos);
    await runFixedTopicsMigration(db);
    const settings = await repo.getSettings();
    const months = await Promise.all(['2026-01', '2026-02'].map((month) => repo.getMonth(month)));

    expect(await runFixedTopicsMigration(db)).toMatchObject({ skipped: true });
    expect(await repo.applyFixedTopics()).toEqual({ topics: 0, entries: 0 });
    expect(await repo.getSettings()).toEqual(settings);
    expect(await Promise.all(['2026-01', '2026-02'].map((month) => repo.getMonth(month)))).toEqual(months);

    const [job] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, FIXED_TOPICS_JOB));
    expect(job).toBeDefined();
  });

  it('traz de volta uma padrão que estava arquivada, com 0%', async () => {
    const id = randomUUID();
    await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
    const repo = new PostgresBudgetRepository(db, id);
    const seeded = (await repo.getSettings()).topics;
    await db
      .update(schema.budgetSettings)
      .set({
        topics: seeded.map((t) =>
          t.preset === 'conhecimentos'
            ? { ...t, archived: true }
            : t.preset === 'diversos'
              ? { ...t, targetPct: t.targetPct + 0.1 }
              : t,
        ),
      })
      .where(eq(schema.budgetSettings.userId, id));

    await repo.applyFixedTopics();
    const topics = (await repo.getSettings()).topics;
    expect(topics.every((t) => !t.archived)).toBe(true);
    expect(topics.find((t) => t.preset === 'conhecimentos')?.targetPct).toBe(0);
    expect(topics.reduce((total, t) => total + t.targetPct, 0)).toBeCloseTo(1, 9);
  });

  it('um backup de antes, com uma categoria criada, entra já com as quatro', async () => {
    const source = await oldAccount();
    await withMonths(source.repo, source.diversos);
    const backup = await source.repo.exportData();
    expect(backup.settings.topics).toHaveLength(5);

    const id = randomUUID();
    await db.insert(schema.user).values({ id, name: 'Outro', email: `${id}@teste.local` });
    const repo = new PostgresBudgetRepository(db, id);
    await repo.importData({ ...backup, version: BACKUP_VERSION });

    const settings = await repo.getSettings();
    expect(settings.topics.map((t) => t.name)).toEqual(DEFAULT_TOPICS.map((t) => t.name));
    const january = (await repo.getMonth('2026-01'))!;
    expect(january.expenses.find((e) => e.id === 'racao')?.topicId).toBe(source.diversos);
    expect(january.topicsSnapshot.map((t) => t.id)).not.toContain('pets');
  });
});
