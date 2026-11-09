import { and, desc, eq, gte, inArray, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { UNASSIGNED_CARD_ID } from '../budget/cards';
import { previousMonth } from '../budget/date';
import type { ModuleFlags, ModuleKey } from '../budget/types';
import {
  availableMissions,
  isoWeek,
  isVisitMission,
  missionDefinition,
  missionsMetByData,
  periodOf,
  restrictedMeetMissions,
  type MissionFacts,
  type MissionKey,
  type MissionsStatus,
} from '../gamification/missions';
import { APP_TIME_ZONE, zonedInstant, zonedToday } from '../reminders/time';
import {
  bankConnections,
  cards,
  expenses,
  incomes,
  installments,
  months,
  pushSubscriptions,
  recurringExpenses,
  reminders,
  xpEvents,
} from './db/schema';
import type { Database } from './db/types';

/** How many months the Missões screen shows the XP of. */
const HISTORY_MONTHS = 6;

/**
 * The XP of one account (lib/gamification/missions.ts). A mission done by data is checked here,
 * against what the account has; one done by going somewhere is reported by the app (a visit),
 * which only counts for a mission the account has. Either way the period is the server's date in
 * São Paulo, and the primary key of `xp_events` keeps each mission to once per period.
 */
export class PostgresMissionsRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  private async exists(table: PgTable, where: SQL | undefined): Promise<boolean> {
    const rows = await this.db.select({ one: sql`1` }).from(table).where(where).limit(1);
    return rows.length > 0;
  }

  /** What the account has today, for the missions that depend on it. */
  async facts(today: string): Promise<MissionFacts> {
    const month = today.slice(0, 7);
    const [
      incomeThisMonth,
      expenseEnteredThisMonth,
      purchaseThisMonth,
      anyIncome,
      anyExpense,
      anyReminder,
      anyCard,
      anyRecurring,
      anyPushDevice,
      anyBankConnection,
      previous,
    ] = await Promise.all([
      this.exists(incomes, and(eq(incomes.userId, this.userId), eq(incomes.month, month))),
      // The charges of an older parcelled purchase come by themselves when the month is created.
      this.exists(
        expenses,
        and(
          eq(expenses.userId, this.userId),
          eq(expenses.month, month),
          or(isNull(expenses.source), ne(expenses.source, 'installment')),
        ),
      ),
      this.exists(
        installments,
        and(eq(installments.userId, this.userId), gte(installments.createdAt, zonedInstant(`${month}-01`, '00:00'))),
      ),
      this.exists(incomes, eq(incomes.userId, this.userId)),
      this.exists(expenses, eq(expenses.userId, this.userId)),
      this.exists(reminders, eq(reminders.userId, this.userId)),
      this.exists(cards, and(eq(cards.userId, this.userId), ne(cards.id, UNASSIGNED_CARD_ID))),
      this.exists(recurringExpenses, eq(recurringExpenses.userId, this.userId)),
      this.exists(pushSubscriptions, eq(pushSubscriptions.userId, this.userId)),
      this.exists(bankConnections, eq(bankConnections.userId, this.userId)),
      this.db
        .select({ closed: months.closed })
        .from(months)
        .where(and(eq(months.userId, this.userId), eq(months.month, previousMonth(month)))),
    ]);
    return {
      incomeThisMonth,
      expenseThisMonth: expenseEnteredThisMonth || purchaseThisMonth,
      anyIncome,
      anyExpense,
      anyReminder,
      anyCard,
      anyRecurring,
      anyPushDevice,
      anyBankConnection,
      previousMonthClosed: previous[0]?.closed ?? null,
    };
  }

  /**
   * Gives the XP of every mission the account just did — the ones its data shows and the `visits`
   * the app reported — and returns where it stands. With `record` false (the Início template),
   * nothing is saved. The "Conhecer" of a `restricted` module gives nothing, and what one gave
   * before it was restricted no longer counts.
   */
  async check({
    modules,
    restricted = [],
    visits = [],
    now = new Date(),
    record = true,
  }: {
    modules: ModuleFlags;
    restricted?: ModuleKey[];
    visits?: string[];
    now?: Date;
    record?: boolean;
  }): Promise<MissionsStatus> {
    const today = zonedToday(now);
    const facts = await this.facts(today);
    const available = availableMissions(modules, facts, restricted);
    const uncounted = restrictedMeetMissions(restricted);
    const counted = uncounted.length > 0 ? notInArray(xpEvents.mission, uncounted) : undefined;
    const offered = new Set<string>(available.map((mission) => mission.key));
    const toEarn = new Set<MissionKey>([
      ...missionsMetByData(available, facts),
      ...(visits.filter((key) => offered.has(key) && isVisitMission(key)) as MissionKey[]),
    ]);

    let earned: MissionsStatus['earned'] = [];
    if (record && toEarn.size > 0) {
      const rows = [...toEarn].map((key) => {
        const mission = missionDefinition(key)!;
        return { userId: this.userId, mission: key, period: periodOf(mission.period, today), xp: mission.xp };
      });
      const inserted = await this.db
        .insert(xpEvents)
        .values(rows)
        .onConflictDoNothing()
        .returning({ mission: xpEvents.mission, xp: xpEvents.xp });
      earned = inserted.map((row) => ({ key: row.mission as MissionKey, xp: row.xp }));
    }

    const periods = ['once', today, isoWeek(today), today.slice(0, 7)];
    const [current, [total], history] = await Promise.all([
      this.db
        .select({ mission: xpEvents.mission, period: xpEvents.period })
        .from(xpEvents)
        .where(and(eq(xpEvents.userId, this.userId), inArray(xpEvents.period, periods))),
      this.db
        .select({ xp: sql<number>`coalesce(sum(${xpEvents.xp}), 0)::int` })
        .from(xpEvents)
        .where(and(eq(xpEvents.userId, this.userId), counted)),
      this.monthsXp(counted),
    ]);
    // Done in its own period: a month mission by a row of this month, a once one by any row.
    const done = new Set(
      current
        .filter((row) => {
          const mission = missionDefinition(row.mission);
          return mission && row.period === periodOf(mission.period, today);
        })
        .map((row) => row.mission),
    );

    return {
      xp: total?.xp ?? 0,
      missions: available.map((mission) => ({
        key: mission.key,
        title: mission.title,
        xp: mission.xp,
        period: mission.period,
        module: mission.module,
        done: done.has(mission.key),
      })),
      months: history,
      earned,
    };
  }

  /** The XP of each of the last months, newest first. */
  private async monthsXp(counted: SQL | undefined): Promise<MissionsStatus['months']> {
    const month = sql<string>`to_char(${xpEvents.earnedAt} at time zone ${sql.raw(`'${APP_TIME_ZONE}'`)}, 'YYYY-MM')`;
    const rows = await this.db
      .select({ month, xp: sql<number>`sum(${xpEvents.xp})::int` })
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, this.userId), counted))
      .groupBy(month)
      .orderBy(desc(month))
      .limit(HISTORY_MONTHS);
    return rows;
  }
}
