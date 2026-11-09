import 'server-only';
import { requireNotVipLocked, type UserAccess } from '../access';

/**
 * Open Finance is on for every account with access to it (it starts restricted, for the owner to
 * try it first). Checked on every request, whatever the browser shows.
 */
export function requireBanksAccess(access: UserAccess): void {
  requireNotVipLocked(access, 'banks');
}

/** "Confira os gastos" launches into Lançamentos: it needs that module too. */
export function requireReviewAccess(access: UserAccess): void {
  requireBanksAccess(access);
  requireNotVipLocked(access, 'expenses');
}
