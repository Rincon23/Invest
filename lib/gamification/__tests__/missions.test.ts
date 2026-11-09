import { describe, expect, it } from 'vitest';
import { ALL_MODULES } from '../../modules/flags';
import { LEVELS, levelOf } from '../levels';
import {
  MISSIONS,
  availableMissions,
  isVisitMission,
  isoWeek,
  missionsMetByData,
  nextMissions,
  periodOf,
  restrictedMeetMissions,
  visitsForPath,
  type MissionFacts,
  type MissionState,
} from '../missions';

const nothing: MissionFacts = {
  incomeThisMonth: false,
  expenseThisMonth: false,
  anyIncome: false,
  anyExpense: false,
  anyReminder: false,
  anyCard: false,
  anyRecurring: false,
  anyPushDevice: false,
  anyBankConnection: false,
  previousMonthClosed: null,
};

describe('missões', () => {
  it('nunca premiam resultado nem valor: XP fixo, título curto e chaves únicas', () => {
    const keys = MISSIONS.map((mission) => mission.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const mission of MISSIONS) {
      expect(mission.xp).toBeGreaterThan(0);
      expect(mission.title.length).toBeLessThanOrEqual(32);
    }
    // Nothing about investing an amount, goals met or what was left.
    expect(JSON.stringify(MISSIONS.map((mission) => mission.title)).toLowerCase()).not.toMatch(/meta|investiu|sobr/);
  });

  it('gasto vale uma vez por mês, os bancos uma vez por semana, o XP do dia uma vez por dia', () => {
    const period = (key: string) => MISSIONS.find((mission) => mission.key === key)?.period;
    expect(period('month-expense')).toBe('month');
    expect(period('check-banks')).toBe('week');
    expect(period('open-app')).toBe('day');
    expect(period('first-expense')).toBe('once');
  });

  it('conta pela data de São Paulo: dia, semana ISO, mês ou uma vez só', () => {
    expect(periodOf('day', '2026-10-26')).toBe('2026-10-26');
    expect(periodOf('month', '2026-10-26')).toBe('2026-10');
    expect(periodOf('once', '2026-10-26')).toBe('once');
    // Monday to Sunday is the same week.
    expect(isoWeek('2026-10-26')).toBe('2026-W44');
    expect(isoWeek('2026-11-01')).toBe('2026-W44');
    expect(isoWeek('2026-11-02')).toBe('2026-W45');
    // The first days of January can belong to the last week of the year before.
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2026-12-31')).toBe('2026-W53');
  });

  it('só oferece o que a conta tem: sem o restrito, sem fatura sem cartão, sem fechar mês sem mês anterior', () => {
    const keys = (modules = ALL_MODULES, facts = nothing) => availableMissions(modules, facts).map((m) => m.key);
    expect(keys()).not.toContain('check-card');
    expect(keys()).not.toContain('close-month');
    expect(keys()).not.toContain('check-banks');
    expect(keys(ALL_MODULES, { ...nothing, anyCard: true, previousMonthClosed: false })).toEqual(
      expect.arrayContaining(['check-card', 'close-month']),
    );
    const withoutBanks = keys({ ...ALL_MODULES, banks: false });
    expect(withoutBanks).not.toContain('connect-bank');
    expect(withoutBanks).not.toContain('meet-banks');
    expect(keys()).toContain('meet-missions');
    // Not even an account with access earns XP for meeting a restricted module.
    const restricted = availableMissions(ALL_MODULES, nothing, ['banks']).map((m) => m.key);
    expect(restricted).not.toContain('meet-banks');
    expect(restricted).toContain('connect-bank');
    expect(restrictedMeetMissions(['banks'])).toContain('meet-banks');
  });

  it('o que os dados mostram fica feito; o resto depende de ir até o lugar', () => {
    const facts = { ...nothing, anyIncome: true, incomeThisMonth: true, previousMonthClosed: true };
    const met = missionsMetByData(availableMissions(ALL_MODULES, facts), facts);
    expect(met).toEqual(expect.arrayContaining(['first-income', 'month-income', 'close-month']));
    // The categories: by "Concluir configuração", whatever the % ended up being.
    expect(isVisitMission('setup-categories')).toBe(true);
    expect(met).not.toContain('first-expense');
    expect(isVisitMission('check-calendar')).toBe(true);
    expect(isVisitMission('meet-card')).toBe(true);
    // Done by data, never by a visit the app reports.
    expect(isVisitMission('first-expense')).toBe(false);
    // "A receber" has no screen: opening its list is the visit.
    expect(isVisitMission('meet-reimbursable')).toBe(true);
    expect(isVisitMission('qualquer-coisa')).toBe(false);
  });

  it('na Início, primeiro as de primeira vez, depois as do mês, e os "Conhecer" por último', () => {
    const state = (key: string, period: MissionState['period'], done = false): MissionState => ({
      key: key as MissionState['key'],
      title: key,
      xp: 10,
      period,
      done,
    });
    const next = nextMissions([
      state('open-app', 'day'),
      state('meet-card', 'once'),
      state('month-expense', 'month'),
      state('first-income', 'once', true),
      state('first-expense', 'once'),
      state('check-banks', 'week'),
    ]);
    expect(next.map((mission) => mission.key)).toEqual(['first-expense', 'month-expense', 'check-banks']);
  });

  it('sabe o que cada tela conta', () => {
    expect(visitsForPath('/cartao')).toEqual(['meet-card', 'check-card']);
    expect(visitsForPath('/carteira/caixa')).toEqual(['meet-cash', 'check-reserve']);
    expect(visitsForPath('/mes/2026-10/lancamentos')).toEqual(['meet-expenses']);
    expect(visitsForPath('/lembretes', '?aba=calendario')).toEqual(['meet-reminders', 'check-calendar']);
    expect(visitsForPath('/bancos/conferir')).toEqual(['meet-banks', 'check-banks']);
    expect(visitsForPath('/missoes')).toEqual(['meet-missions']);
    expect(visitsForPath('/mes/2026-10')).toEqual([]);
  });
});

describe('níveis', () => {
  it('crescem como uma árvore, com nomes cada vez melhores', () => {
    expect(LEVELS.map((level) => level.name)).toEqual([
      'Semente',
      'Broto',
      'Muda',
      'Arbusto',
      'Árvore',
      'Árvore florida',
      'Árvore com frutos',
      'Pomar',
      'Bosque',
      'Floresta',
    ]);
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].xp).toBeGreaterThan(LEVELS[i - 1].xp);
  });

  it('diz o nível, o quanto falta e a barra', () => {
    expect(levelOf(0)).toMatchObject({ level: 1, name: 'Semente', floor: 0, next: 150, progress: 0 });
    expect(levelOf(275)).toMatchObject({ level: 2, name: 'Broto', floor: 150, next: 400, progress: 0.5 });
    expect(levelOf(800)).toMatchObject({ level: 4, name: 'Arbusto' });
    expect(levelOf(20_000)).toMatchObject({ level: 10, name: 'Floresta', next: null, progress: 1 });
    expect(levelOf(-5)).toMatchObject({ level: 1, xp: 0 });
  });
});
