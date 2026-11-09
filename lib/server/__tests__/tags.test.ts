// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeMonthSummary, type Expense, type Tag } from '@/lib/budget';
import { BACKUP_VERSION, MonthClosedError } from '@/lib/storage/repository';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresWalletRepository } from '../walletRepository';

/**
 * Tags on the real schema: they label entries, templates and plans, survive renames, go away
 * everywhere at once (and come back with "Desfazer"), work in a closed month — and never change a
 * number.
 */

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

async function newAccount() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  const budget = new PostgresBudgetRepository(db, id);
  const settings = await budget.getSettings();
  return { id, budget, wallet: new PostgresWalletRepository(db, id, budget), main: settings.topics[0].id };
}

const tag = (name: string, kind: Tag['kind'] = 'expense', order = 0): Tag => ({
  id: randomUUID(),
  name,
  kind,
  order,
});

function spend(topicId: string, overrides: Partial<Expense> = {}): Expense {
  return {
    id: randomUUID(),
    categoryKind: 'topic',
    topicId,
    description: 'Feira',
    amount: 100,
    date: '2026-03-10',
    ...overrides,
  };
}

describe('tags', () => {
  it('cria, renomeia em todos os lançamentos e recusa nome repetido ou de categoria', async () => {
    const { budget, main } = await newAccount();
    const mercado = tag('Mercado');
    expect(await budget.saveTag(mercado)).toEqual([mercado]);
    const expense = spend(main, { tagIds: [mercado.id] });
    await budget.saveExpense('2026-03', expense);

    await budget.saveTag({ ...mercado, name: 'Supermercado', color: '#00aa00' });
    const settings = await budget.getSettings();
    expect(settings.tags).toEqual([{ ...mercado, name: 'Supermercado', color: '#00aa00' }]);
    // The expense keeps the id: the new name is what every list shows.
    expect((await budget.getMonth('2026-03'))?.expenses[0].tagIds).toEqual([mercado.id]);

    await expect(budget.saveTag(tag('supermercado'))).rejects.toThrow('Já existe uma tag com esse nome.');
    await expect(budget.saveTag(tag('Metas'))).rejects.toThrow(/categoria/);
    // The same word as a tag of incomes is another list.
    await budget.saveTag(tag('Supermercado', 'income'));
  });

  it('um gasto só guarda tags de gasto que existem', async () => {
    const { budget, main } = await newAccount();
    const mercado = tag('Mercado');
    const bico = tag('Bico', 'income');
    await budget.saveTag(mercado);
    await budget.saveTag(bico);

    await budget.saveExpense(
      '2026-03',
      spend(main, { id: 'e1', tagIds: [mercado.id, bico.id, 'sumiu', mercado.id] }),
    );
    await budget.saveIncome('2026-03', {
      id: 'i1',
      source: 'Pintura',
      amount: 300,
      tagIds: [bico.id, mercado.id],
    });

    const month = await budget.getMonth('2026-03');
    expect(month?.expenses[0].tagIds).toEqual([mercado.id]);
    expect(month?.incomes[0].tagIds).toEqual([bico.id]);
  });

  it('um cliente antigo, que não manda tags, não apaga as que o lançamento tem', async () => {
    const { budget, main } = await newAccount();
    const mercado = tag('Mercado');
    await budget.saveTag(mercado);
    const expense = spend(main, { tagIds: [mercado.id] });
    await budget.saveExpense('2026-03', expense);

    await budget.saveExpense('2026-03', { ...expense, tagIds: undefined, amount: 120 });
    const [saved] = (await budget.getMonth('2026-03'))!.expenses;
    expect(saved).toMatchObject({ amount: 120, tagIds: [mercado.id] });

    // An empty list is a choice: it takes them off.
    await budget.saveExpense('2026-03', { ...expense, tagIds: [] });
    expect((await budget.getMonth('2026-03'))!.expenses[0].tagIds).toBeUndefined();
  });

  it('salvar as configurações não traz de volta nem apaga tags', async () => {
    const { budget } = await newAccount();
    const stale = await budget.getSettings();
    const mercado = tag('Mercado');
    await budget.saveTag(mercado);

    await budget.saveSettings({ ...stale, tags: [tag('Fantasma')] });
    expect((await budget.getSettings()).tags).toEqual([mercado]);
  });

  it('põe tag num mês fechado sem mudar nenhum número, e o resto continua recusado', async () => {
    const { budget, main } = await newAccount();
    await budget.saveIncome('2026-03', { id: 'sal', source: 'Salário', amount: 2000 });
    const feira = spend(main, { id: 'feira' });
    await budget.saveExpense('2026-03', feira);
    await budget.closeMonth('2026-03', true);
    const before = await budget.getMonth('2026-03');
    const carried = (await budget.getMonth('2026-04'))?.carryIn;

    const [mercado] = await budget.saveTag(tag('Mercado'));
    const [bico] = (await budget.saveTag(tag('Bico', 'income'))).filter((t) => t.kind === 'income');
    await budget.setEntryTags('2026-03', 'expense', 'feira', [mercado.id]);
    await budget.setEntryTags('2026-03', 'income', 'sal', [bico.id]);

    const after = (await budget.getMonth('2026-03'))!;
    expect(after.expenses[0].tagIds).toEqual([mercado.id]);
    expect(after.incomes[0].tagIds).toEqual([bico.id]);
    expect(computeMonthSummary(after)).toEqual(computeMonthSummary(before!));
    expect((await budget.getMonth('2026-04'))?.carryIn).toEqual(carried);

    await expect(budget.saveExpense('2026-03', { ...feira, amount: 1 })).rejects.toBeInstanceOf(
      MonthClosedError,
    );
    await expect(budget.setEntryTags('2026-03', 'expense', 'nao-existe', [])).rejects.toThrow(/não existe/);
  });

  it('apagar tira a tag de tudo, e "Desfazer" devolve', async () => {
    const { budget, wallet, main } = await newAccount();
    const mercado = tag('Mercado');
    const viagem = tag('Viagem', 'expense', 1);
    await budget.saveTag(mercado);
    await budget.saveTag(viagem);
    await budget.saveExpense('2026-03', spend(main, { id: 'a', tagIds: [mercado.id, viagem.id] }));
    await budget.saveExpense('2026-04', spend(main, { id: 'b', date: '2026-04-02', tagIds: [mercado.id] }));
    await budget.saveExpense('2026-04', spend(main, { id: 'c', date: '2026-04-03', tagIds: [viagem.id] }));
    await wallet.saveRecurring({
      id: 'r1',
      categoryKind: 'topic',
      topicId: main,
      description: 'Feira do mês',
      amount: 400,
      card: false,
      tagIds: [mercado.id],
    });
    await budget.closeMonth('2026-03');
    expect(await budget.tagUsage()).toEqual({ [mercado.id]: 2, [viagem.id]: 2 });

    const { tags, refs } = await budget.deleteTag(mercado.id);
    expect(tags).toEqual([viagem]);
    expect(refs.expenses.map((ref) => ref.id).sort()).toEqual(['a', 'b']);
    expect(refs.recurring).toEqual(['r1']);
    expect((await budget.getMonth('2026-03'))?.expenses[0].tagIds).toEqual([viagem.id]);
    expect((await budget.getMonth('2026-04'))?.expenses.find((e) => e.id === 'b')?.tagIds).toBeUndefined();
    expect((await wallet.getSnapshot()).recurring[0].tagIds).toBeUndefined();

    expect(await budget.restoreTag(mercado, refs)).toEqual([viagem, mercado]);
    expect((await budget.getMonth('2026-03'))?.expenses[0].tagIds).toEqual([viagem.id, mercado.id]);
    expect((await budget.getMonth('2026-04'))?.expenses.find((e) => e.id === 'b')?.tagIds).toEqual([
      mercado.id,
    ]);
    expect((await wallet.getSnapshot()).recurring[0].tagIds).toEqual([mercado.id]);
  });

  it('o gasto lançado de uma conta do mês ou de um parcelamento nasce com as tags dela', async () => {
    const { budget, wallet, main } = await newAccount();
    const [assinatura] = await budget.saveTag(tag('Assinatura'));
    const casa = tag('Casa', 'expense', 1);
    await budget.saveTag(casa);

    await wallet.saveRecurring({
      id: 'netflix',
      categoryKind: 'fixedCost',
      description: 'Netflix',
      amount: 40,
      card: false,
      tagIds: [assinatura.id],
    });
    await wallet.launchRecurring('netflix', '2026-03', '2026-03-05');

    await budget.ensureMonth('2026-03');
    await budget.ensureMonth('2026-04');
    await wallet.saveInstallment({
      id: 'tv',
      name: 'TV',
      categoryKind: 'topic',
      topicId: main,
      firstDebitDate: '2026-03-10',
      purchaseDate: '2026-03-01',
      count: 3,
      totalAmount: 300,
      accounting: 'installment',
      tagIds: [casa.id],
    });
    // A month created later gets its charge with the tags too.
    await budget.ensureMonth('2026-05');

    const tagsOf = async (month: string, find: (e: Expense) => boolean) =>
      (await budget.getMonth(month))?.expenses.find(find)?.tagIds;
    expect(await tagsOf('2026-03', (e) => e.recurringId === 'netflix')).toEqual([assinatura.id]);
    for (const month of ['2026-03', '2026-04', '2026-05']) {
      expect(await tagsOf(month, (e) => e.installmentId === 'tv')).toEqual([casa.id]);
    }

    // Editing the purchase from a client that does not send tags keeps them on every charge.
    const [plan] = (await wallet.getSnapshot()).installments;
    await wallet.saveInstallment({ ...plan, name: 'Televisão', tagIds: undefined });
    expect(await tagsOf('2026-04', (e) => e.installmentId === 'tv')).toEqual([casa.id]);
  });

  it('o backup leva as tags (v4) e um de antes (v3) entra sem elas', async () => {
    const source = await newAccount();
    const mercado = tag('Mercado');
    await source.budget.saveTag(mercado);
    await source.budget.saveExpense('2026-03', spend(source.main, { id: 'x', tagIds: [mercado.id] }));
    const backup = await source.budget.exportData();
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(BACKUP_VERSION).toBe(4);

    const target = await newAccount();
    await target.budget.importData(backup);
    expect((await target.budget.getSettings()).tags).toEqual([mercado]);
    expect((await target.budget.getMonth('2026-03'))?.expenses[0].tagIds).toEqual([mercado.id]);
    const again = await target.budget.exportData();
    expect({ ...again, exportedAt: '' }).toEqual({ ...backup, exportedAt: '' });

    const old = await newAccount();
    // What a backup from before tags looks like: no `tags`, no `tagIds`.
    const settingsV3 = { ...backup.settings };
    delete settingsV3.tags;
    await old.budget.importData({
      ...backup,
      version: 3,
      settings: settingsV3,
      months: backup.months.map((m) => ({
        ...m,
        expenses: m.expenses.map((e) => {
          const copy = { ...e };
          delete copy.tagIds;
          return copy;
        }),
      })),
    });
    expect((await old.budget.getSettings()).tags).toEqual([]);
    expect((await old.budget.getMonth('2026-03'))?.expenses[0].tagIds).toBeUndefined();
  });
});
