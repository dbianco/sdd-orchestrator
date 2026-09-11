import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { withTransaction } from '../../../src/db/pool.js';
import { createApp, getAppBySlug } from '../../../src/store/apps.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('withTransaction', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('commits on success', async () => {
    const pool = await getTestPool();
    const totalBefore = pool.totalCount;

    const created = await withTransaction(pool, async (client) => createApp(client, { slug: 'checkout', name: 'Checkout' }, 'daniel'));

    expect(created.slug).toBe('checkout');
    // Visible via the bare pool, outside the transaction: it really committed.
    expect((await getAppBySlug(pool, 'checkout'))?.id).toBe(created.id);
    // The client was released back to the pool afterward, not leaked.
    expect(pool.totalCount).toBe(totalBefore);
  });

  it('rolls back on error', async () => {
    const pool = await getTestPool();
    const totalBefore = pool.totalCount;

    await expect(
      withTransaction(pool, async (client) => {
        await createApp(client, { slug: 'checkout', name: 'Checkout' }, 'daniel');
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    // No row was created: the transaction rolled back cleanly.
    expect(await getAppBySlug(pool, 'checkout')).toBeNull();
    // The client was still released back to the pool despite the error.
    expect(pool.totalCount).toBe(totalBefore);
  });
});
