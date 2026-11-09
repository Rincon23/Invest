import type { BudgetSettings, ModuleFlags, ModuleKey } from '../budget/types';
import { MODULES, MODULE_KEYS, moduleDefinition } from './catalog';

/**
 * Every module on: what every account has. Nobody turns modules on or off anymore — even someone
 * without a card has Cartão. The only ones an account goes without are the restricted modules it
 * has no access to (`effectiveModules`).
 */
export const ALL_MODULES: ModuleFlags = Object.fromEntries(
  MODULE_KEYS.map((key) => [key, true]),
) as unknown as ModuleFlags;

type FlagsSource = Pick<BudgetSettings, 'modules'> | Partial<ModuleFlags> | null | undefined;

/**
 * The flags as saved, before any dependency is taken into account. Absent means on: the server
 * only ever saves `false` for a restricted module the account may not use, and a module added to
 * the catalog later is on for everyone without touching anybody's data.
 */
export function storedModules(source: FlagsSource): ModuleFlags {
  const modules: Partial<ModuleFlags> | null | undefined =
    source && 'modules' in source ? source.modules : (source as Partial<ModuleFlags> | null | undefined);
  const stored = { ...ALL_MODULES };
  for (const key of MODULE_KEYS) stored[key] = modules?.[key] !== false;
  return stored;
}

/**
 * Which modules are actually on. A module counts as on only while everything it depends on is
 * on too (with Lançamentos restricted, so is everything built on it). This is what every screen
 * and the server check.
 */
export function resolveModules(source: FlagsSource): ModuleFlags {
  const stored = storedModules(source);
  const resolved = { ...ALL_MODULES };
  // Catalog order puts every module after its dependencies, so one pass is enough.
  for (const definition of MODULES) {
    resolved[definition.key] = stored[definition.key] && definition.dependsOn.every((dep) => resolved[dep]);
  }
  return resolved;
}

export function isModuleOn(source: FlagsSource, key: ModuleKey): boolean {
  return resolveModules(source)[key];
}

/** What decides which modules an account has. */
export interface ModuleAccess {
  /** An account with access to the restricted modules (the owner always has it). */
  vip: boolean;
  /** The restricted modules, as the owner set them in Administração. */
  vipModules: ModuleKey[];
}

/** The restricted modules before the owner changes anything (`ModuleDefinition.vipByDefault`). */
export const DEFAULT_VIP_MODULES: ModuleKey[] = MODULES.filter((definition) => definition.vipByDefault).map(
  (definition) => definition.key,
);

/**
 * The restricted modules from the owner's choices ("Restrito" in Administração, one per module): a
 * module the owner never touched keeps its default. In catalog order.
 */
export function vipModulesFrom(choices: Partial<Record<ModuleKey, boolean>>): ModuleKey[] {
  return MODULES.filter((definition) => choices[definition.key] ?? definition.vipByDefault === true).map(
    (definition) => definition.key,
  );
}

/** Whether this account may use `key` by itself (it may still be built on a restricted one). */
export function mayUseModule(access: ModuleAccess, key: ModuleKey): boolean {
  return access.vip || !access.vipModules.includes(key);
}

/**
 * The restricted module that keeps `key` out of this account's reach: `key` itself, or one it needs
 * (with Lançamentos restricted, so is everything built on it). Null when nothing does.
 */
export function vipLockOf(access: ModuleAccess, key: ModuleKey): ModuleKey | null {
  if (!mayUseModule(access, key)) return key;
  for (const dep of moduleDefinition(key).dependsOn) {
    const lock = vipLockOf(access, dep);
    if (lock) return lock;
  }
  return null;
}

/**
 * Whether `key` is hidden from this account: a restricted module ("Restrito" in Administração), or
 * one built on it, never shows up for an account without access — not in the app drawer, not in
 * the widget tray, and its address answers "not found". Nobody else learns it exists.
 */
export function isModuleHidden(access: ModuleAccess, key: ModuleKey): boolean {
  return vipLockOf(access, key) !== null;
}

/** The modules this account has: all of them, but the restricted ones it may not use. */
export function effectiveModules(access: ModuleAccess): ModuleFlags {
  return Object.fromEntries(
    MODULE_KEYS.map((key) => [key, !isModuleHidden(access, key)]),
  ) as unknown as ModuleFlags;
}

/**
 * The settings with the modules this account has, whatever was saved (an old backup, a payload
 * from an older app, access given or taken back): nothing the person sends can turn a module off,
 * and nothing turns a restricted one on.
 */
export function withAccessRules<T extends Pick<BudgetSettings, 'modules'>>(settings: T, access: ModuleAccess): T {
  return { ...settings, modules: effectiveModules(access) };
}

/** Every module that needs `key`, directly or through another module, in catalog order. */
export function dependentsOf(key: ModuleKey): ModuleKey[] {
  const found = new Set<ModuleKey>();
  for (const definition of MODULES) {
    if (definition.dependsOn.some((dep) => dep === key || found.has(dep))) found.add(definition.key);
  }
  return MODULE_KEYS.filter((candidate) => found.has(candidate));
}

/**
 * The one module a module hangs from: of its dependencies, the one that isn't already required by
 * another of them. The Início puts a module without a screen (the card bill, "A receber") right
 * after it. Null for modules that depend on nothing.
 */
export function parentOf(key: ModuleKey): ModuleKey | null {
  const deps = moduleDefinition(key).dependsOn;
  const direct = deps.filter((dep) => !deps.some((other) => other !== dep && requires(other, dep)));
  return direct[0] ?? null;
}

/** Whether `key` needs `other`, directly or not. */
function requires(key: ModuleKey, other: ModuleKey): boolean {
  return moduleDefinition(key).dependsOn.some((dep) => dep === other || requires(dep, other));
}
