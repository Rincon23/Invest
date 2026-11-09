import type { SelfTestArea } from '../../admin/types';
import { MODULE_KEYS } from '../../modules';
import type { SelfCheck } from './check';
import { missionsChecks, remindersChecks } from './checks/assistant';
import { banksChecks, diagramChecks } from './checks/investing';
import { budgetChecks, expensesChecks, historyChecks, reimbursableChecks } from './checks/month';
import { serverChecks } from './checks/server';
import { cardChecks, cashChecks, recurringChecks } from './checks/wallet';

/**
 * Every automatic test, by what it is about. Keyed by every module: a new module does not compile
 * until it has its tests here, and the Administração list follows this order.
 */
export const SELF_CHECKS: Record<SelfTestArea, SelfCheck[]> = {
  server: serverChecks,
  missions: missionsChecks,
  expenses: expensesChecks,
  budget: budgetChecks,
  card: cardChecks,
  reimbursable: reimbursableChecks,
  history: historyChecks,
  recurring: recurringChecks,
  cash: cashChecks,
  banks: banksChecks,
  diagram: diagramChecks,
  reminders: remindersChecks,
};

/** The areas in the order Administração shows them: the server, then the modules in catalog order. */
export const SELF_TEST_AREAS: SelfTestArea[] = ['server', ...MODULE_KEYS];
