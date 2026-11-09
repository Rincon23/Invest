import type { AppSettings, ModuleKey, NavKey } from '../core/types';
import { MODULES, MODULE_GROUPS, moduleDefinition, type ModuleGroup } from './catalog';
import { resolveModules } from './flags';

export interface NavEntry {
  key: NavKey;
  label: string;
  href: () => string;
  isActive: (pathname: string) => boolean;
}

/** The home screen (the áreas de trabalho). It is not a module: it always exists. */
export const HOME_NAV: NavEntry = {
  key: 'inicio',
  label: 'Início',
  href: () => '/',
  isActive: (pathname) => pathname === '/',
};

type NavSource = Pick<AppSettings, 'modules'> | null | undefined;

export function navEntry(key: NavKey): NavEntry {
  if (key === 'inicio') return HOME_NAV;
  const { screen } = moduleDefinition(key);
  if (!screen) throw new Error(`O módulo ${key} não tem tela.`);
  return { key, ...screen };
}

export interface MoreGroup {
  group: ModuleGroup;
  label: string;
  keys: ModuleKey[];
}

/**
 * The module screens the app drawer lists besides its fixed entries: every module that is on and
 * has a screen, grouped. The drawer is the full list of apps.
 */
export function moreItems(source: NavSource): MoreGroup[] {
  const modules = resolveModules(source);
  return MODULE_GROUPS.map(({ key, label }) => ({
    group: key,
    label,
    keys: MODULES.filter((m) => m.group === key && m.screen && modules[m.key]).map((m) => m.key),
  })).filter((group) => group.keys.length > 0);
}

/** The query that opens the Início with the app drawer already up. */
export const OPEN_APPS_PARAM = 'apps';

/** Where every screen's back arrow leads: the Início. */
export function homeHref(): string {
  return HOME_NAV.href();
}
