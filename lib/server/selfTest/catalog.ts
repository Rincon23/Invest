import type { SelfTestArea } from '../../admin/types';
import { MODULE_KEYS } from '../../modules';
import type { SelfCheck } from './check';
import { banksChecks, diagramChecks, historyChecks } from './checks/investing';
import { serverChecks } from './checks/server';

/**
 * Every automatic test, by what it is about. Keyed by every module: a new module does not compile
 * until it has its tests here, and the Administração list follows this order.
 */
export const SELF_CHECKS: Record<SelfTestArea, SelfCheck[]> = {
  server: serverChecks,
  diagram: diagramChecks,
  history: historyChecks,
  banks: banksChecks,
};

/** The areas in the order Administração shows them: the server, then the modules in catalog order. */
export const SELF_TEST_AREAS: SelfTestArea[] = ['server', ...MODULE_KEYS];
