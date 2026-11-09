import 'server-only';
import { createHash } from 'node:crypto';

const TIMEOUT_MS = 3000;

/**
 * Whether `password` is in Have I Been Pwned's list of leaked passwords — the first ones any
 * attacker tries. Free, no key, and private: only the first 5 characters of the password's SHA-1
 * leave the server (k-anonymity), and the answer is padded so its size gives nothing away either.
 * If the service can't be reached the password is accepted: a slow outside service must never
 * stop someone from creating an account.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'Capital' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    for (const line of (await response.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':');
      // Padding lines have a count of 0.
      if (candidate === suffix) return Number(count) > 0;
    }
    return false;
  } catch {
    return false;
  }
}
