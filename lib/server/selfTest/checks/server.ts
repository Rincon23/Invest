import { readFile, statfs } from 'node:fs/promises';
import path from 'node:path';
import { count, sql } from 'drizzle-orm';
import { pgSchema, serial } from 'drizzle-orm/pg-core';
import { createId } from '../../../budget/id';
import { factOfDay } from '../../../motivation';
import { bankKeys } from '../../db/schema';
import { createFact, deleteFact, listFacts, updateFact } from '../../factsRepository';
import { lastRun } from '../../jobRuns';
import { checkMailer } from '../../mailer';
import { MOTIVATION_JOB } from '../../motivation';
import { sendUserNotification } from '../../notify';
import { PostgresNotificationsRepository } from '../../notificationsRepository';
import { checkVapidKeys } from '../../push';
import { schedulerRunning } from '../../scheduler';
import { canEncryptSecrets, decryptSecret, encryptSecret } from '../../secretBox';
import { expect, expectEqual, type SelfCheck } from '../check';

/** The server itself: the database, the background jobs and what the modules all lean on. */

const SLOW_DATABASE_MS = 2_000;

/** Where Drizzle records each migration it applied (kept out of schema.ts: drizzle-kit owns that). */
const appliedMigrations = pgSchema('drizzle').table('__drizzle_migrations', {
  id: serial('id').primaryKey(),
});
/** The minute loop marks the reminders job every minute; past this, it stopped. */
const SCHEDULER_LATE_MS = 5 * 60 * 1000;
/** Right after a start the loop hasn't had its first minute yet. */
const SCHEDULER_WARMUP_SECONDS = 3 * 60;
/** The fact of the week goes out every Monday; a day of margin for a server that was off. */
const MOTIVATION_LATE_MS = 8 * 24 * 60 * 60 * 1000;
const MAIL_TIMEOUT_MS = 10_000;
const DISK_WARN = 0.1;
const DISK_FAIL = 0.03;

function inProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const serverChecks: SelfCheck[] = [
  {
    id: 'server.database',
    name: 'Banco de dados respondendo',
    async run({ db }) {
      const started = performance.now();
      await db.execute(sql`select 1`);
      const ms = Math.round(performance.now() - started);
      if (ms > SLOW_DATABASE_MS) return { status: 'warn', message: `O banco levou ${ms} ms para responder.` };
    },
  },
  {
    id: 'server.migrations',
    name: 'Banco com todas as migrações',
    async run({ db }) {
      const journal = JSON.parse(
        await readFile(path.join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: unknown[] };
      const [{ applied }] = await db.select({ applied: count() }).from(appliedMigrations);
      const missing = journal.entries.length - applied;
      expect(
        missing <= 0,
        `Faltam ${missing} migrações no banco: o servidor está rodando com tabelas antigas.`,
      );
    },
  },
  {
    id: 'server.scheduler',
    name: 'Tarefas em segundo plano rodando',
    async run({ db, now }) {
      if (!schedulerRunning()) {
        return {
          status: 'skip',
          message: 'As tarefas em segundo plano estão desligadas aqui (SCHEDULER=off).',
        };
      }
      if (process.uptime() < SCHEDULER_WARMUP_SECONDS) {
        return { status: 'skip', message: 'O servidor acabou de ligar; confere na próxima rodada.' };
      }
      const last = await lastRun(db, 'reminders');
      expect(
        last && now.getTime() - last.getTime() < SCHEDULER_LATE_MS,
        last
          ? `Lembretes, faturas e contas do mês não são avisados desde ${last.toLocaleString('pt-BR')}.`
          : 'As tarefas em segundo plano nunca rodaram.',
      );
    },
  },
  {
    id: 'server.facts',
    name: 'Frases do "Você sabia?"',
    run: ({ scratch }) =>
      scratch(async ({ db, today }) => {
        const facts = await listFacts(db);
        expect(facts.length > 0, 'Não há nenhuma frase para mostrar.');
        expect(factOfDay(facts, today), 'Nenhuma frase para hoje.');
        const input = { text: 'Autoteste', detail: 'Frase de teste.', sourceLabel: 'Teste', sourceUrl: null };
        const created = await createFact(db, input);
        await updateFact(db, created.id, { ...input, text: 'Autoteste editado' });
        expectEqual((await listFacts(db)).at(-1)?.text, 'Autoteste editado', 'Última frase');
        await deleteFact(db, created.id);
        expectEqual((await listFacts(db)).length, facts.length, 'Frases depois de excluir');
      }),
  },
  {
    id: 'server.motivation',
    name: 'Frase da semana saindo',
    async run({ db, now }) {
      const last = await lastRun(db, MOTIVATION_JOB);
      if (!schedulerRunning() || !last) {
        return { status: 'skip', message: 'A próxima frase sai na segunda-feira.' };
      }
      expect(
        now.getTime() - last.getTime() < MOTIVATION_LATE_MS,
        `A frase da semana não sai desde ${last.toLocaleString('pt-BR')}.`,
      );
    },
  },
  {
    id: 'server.notifications',
    name: 'Central de notificações guarda o aviso',
    run: ({ scratch }) =>
      scratch(async ({ db, userId }) => {
        const sourceKey = `autoteste-${createId()}`;
        const message = { title: 'Autoteste', body: 'Aviso de teste.', url: '/admin' };
        expect(
          await sendUserNotification(db, userId, { category: 'system', message, sourceKey }),
          'O aviso não foi guardado na Central de notificações.',
        );
        expect(
          !(await sendUserNotification(db, userId, { category: 'system', message, sourceKey })),
          'O mesmo aviso foi guardado duas vezes.',
        );
        const { notifications, unread } = await new PostgresNotificationsRepository(db, userId).list();
        expectEqual(
          notifications.map((item) => item.title),
          ['Autoteste'],
          'Avisos no sino',
        );
        expectEqual(unread, 1, 'Avisos não lidos');
      }),
  },
  {
    id: 'server.backup',
    name: 'Backup exporta e importa sem perder nada',
    run: ({ scratch }) =>
      scratch(async ({ budget, diagram, month, today }) => {
        await budget.saveIncome(month, { id: createId(), source: 'Salário', amount: 2500, date: today });
        await budget.saveExpense(month, {
          id: createId(),
          categoryKind: 'fixedCost',
          description: 'Aluguel',
          amount: 900,
          date: today,
        });
        await diagram.setFixedIncome('fixedIncome', 4000, today);
        const backup = await budget.exportData();
        const diagramBackup = await diagram.exportData();

        await budget.clearAll();
        await diagram.clear();
        expectEqual(await budget.listMonths(), [], 'Meses depois de apagar tudo');

        await budget.importData(backup);
        await diagram.importData(diagramBackup);
        const restored = await budget.getMonth(month);
        expectEqual(
          restored?.incomes.map((item) => item.amount),
          [2500],
          'Rendas depois de importar',
        );
        expectEqual(
          restored?.expenses.map((item) => item.amount),
          [900],
          'Gastos depois de importar',
        );
        expectEqual(
          (await diagram.exportData()).fixedIncome.map((item) => item.amount),
          [4000],
          'Renda fixa do Diagrama depois de importar',
        );
      }),
  },
  {
    id: 'server.encryption',
    name: 'Chave que protege o Open Finance',
    async run({ db }) {
      const [bank] = await db.select({ secret: bankKeys.clientSecret }).from(bankKeys).limit(1);
      if (!canEncryptSecrets()) {
        expect(!bank, 'Sem ENCRYPTION_KEY: ninguém consegue usar o Open Finance já ligado.');
        return { status: 'skip', message: 'Sem ENCRYPTION_KEY: o Open Finance não pode ser ligado.' };
      }
      expectEqual(decryptSecret(encryptSecret('autoteste')), 'autoteste', 'Segredo cifrado e decifrado');
      // A changed key locks everyone out of what they already connected.
      if (bank) {
        try {
          decryptSecret(bank.secret);
        } catch {
          throw new Error(
            'A ENCRYPTION_KEY atual não abre os segredos do Open Finance guardados: ela foi trocada?',
          );
        }
      }
    },
  },
  {
    id: 'server.mail',
    name: 'E-mail (SMTP) aceitando login',
    external: true,
    async run() {
      const configured = await withTimeout(
        checkMailer(),
        MAIL_TIMEOUT_MS,
        'O servidor de e-mail não respondeu em 10 s.',
      );
      if (!configured) {
        const message = 'Sem SMTP: confirmação de conta e troca de senha não chegam por e-mail.';
        return inProduction() ? { status: 'warn', message } : { status: 'skip', message };
      }
    },
  },
  {
    id: 'server.push',
    name: 'Chaves das notificações no celular (VAPID)',
    async run() {
      if (!checkVapidKeys()) {
        const message = 'Sem chaves VAPID: nenhum aviso chega ao celular.';
        return inProduction() ? { status: 'warn', message } : { status: 'skip', message };
      }
    },
  },
  {
    id: 'server.disk',
    name: 'Espaço livre no disco',
    async run() {
      const stats = await statfs(process.cwd());
      const free = stats.bavail / stats.blocks;
      const left = `${Math.round(free * 100)}% livre (${((stats.bavail * stats.bsize) / 1024 ** 3).toFixed(1)} GB)`;
      expect(free >= DISK_FAIL, `O disco está quase cheio: ${left}. O banco pode parar de gravar.`);
      if (free < DISK_WARN) return { status: 'warn', message: `O disco está enchendo: ${left}.` };
    },
  },
];
