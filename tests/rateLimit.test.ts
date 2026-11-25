import { describe, expect, it } from 'vitest';
import { checkRateLimit, resetRateLimit } from '../src/worker/services/rateLimit';
import { createTestD1 } from './helpers/mockD1';

describe('checkRateLimit', () => {
  it('allows calls under the limit and blocks once the limit is reached', async () => {
    const db = createTestD1();
    const key = 'test:1';

    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit(db, key, { maxAttempts: 3, windowSeconds: 60 })).toBe(true);
    }
    expect(await checkRateLimit(db, key, { maxAttempts: 3, windowSeconds: 60 })).toBe(false);
  });

  it('tracks different keys independently', async () => {
    const db = createTestD1();
    await checkRateLimit(db, 'a', { maxAttempts: 1, windowSeconds: 60 });
    const blockedA = await checkRateLimit(db, 'a', { maxAttempts: 1, windowSeconds: 60 });
    const allowedB = await checkRateLimit(db, 'b', { maxAttempts: 1, windowSeconds: 60 });
    expect(blockedA).toBe(false);
    expect(allowedB).toBe(true);
  });

  it('resetRateLimit clears the counter so the key is immediately allowed again', async () => {
    const db = createTestD1();
    const key = 'test:2';
    await checkRateLimit(db, key, { maxAttempts: 1, windowSeconds: 60 });
    expect(await checkRateLimit(db, key, { maxAttempts: 1, windowSeconds: 60 })).toBe(false);

    await resetRateLimit(db, key);
    expect(await checkRateLimit(db, key, { maxAttempts: 1, windowSeconds: 60 })).toBe(true);
  });
});
