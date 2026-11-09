import { describe, expect, it } from 'vitest';
import { allowAttempt, rateLimitKeyCount } from '../rateLimit';

describe('allowAttempt', () => {
  it('allows up to the limit in a window, then blocks until the window ends', () => {
    const key = `teste-${Math.random()}`;
    expect(allowAttempt(key, 2, 1000, 0)).toBe(true);
    expect(allowAttempt(key, 2, 1000, 10)).toBe(true);
    expect(allowAttempt(key, 2, 1000, 20)).toBe(false);
    expect(allowAttempt(key, 2, 1000, 1000)).toBe(true);
  });

  it('counts each key separately', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(allowAttempt(a, 1, 1000, 0)).toBe(true);
    expect(allowAttempt(a, 1, 1000, 1)).toBe(false);
    expect(allowAttempt(b, 1, 1000, 1)).toBe(true);
  });

  it('never keeps more than a bounded number of keys, however many arrive', () => {
    for (let i = 0; i < 25_000; i++) allowAttempt(`flood-${i}`, 5, 60_000, 0);
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(20_000);
  });
});
