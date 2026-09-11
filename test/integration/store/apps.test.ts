import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp, getAppBySlug, requireApp, updateApp, addStopCondition, listApps } from '../../../src/store/apps.js';
import { appendPolicy, currentPolicy, PolicySchema } from '../../../src/store/policies.js';
import { DomainError } from '../../../src/errors.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('apps and policies', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('creates, reads and updates an app', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout', compliance: true }, 'daniel');
    expect(app.id).toMatch(/^a_/);
    expect(app.compliance).toBe(true);
    expect(app.created_by).toBe('daniel');
    const updated = await updateApp(pool, 'checkout', { default_stack: ['typescript', 'react'], token_budget: 5000, min_similarity: 0.4 }, 'daniel');
    expect(updated.default_stack).toEqual(['typescript', 'react']);
    expect(updated.token_budget).toBe(5000);
    expect(updated.min_similarity).toBeCloseTo(0.4);
    const withStop = await addStopCondition(pool, 'checkout', 'Never change tax rounding', 'daniel');
    expect(withStop.stop_conditions).toEqual(['Never change tax rounding']);
    expect((await getAppBySlug(pool, 'checkout'))?.slug).toBe('checkout');
    expect(await getAppBySlug(pool, 'nope')).toBeNull();
    await expect(requireApp(pool, 'nope')).rejects.toBeInstanceOf(DomainError);
  });

  it('appends policy versions and reads the current one', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'daniel');
    expect(await currentPolicy(pool, app.id)).toBeNull();
    const p1 = await appendPolicy(pool, app.id, PolicySchema.parse({ framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }] }), 'PCI', 'daniel');
    expect(p1.version).toBe(1);
    expect(p1.policy.risk_paths).toEqual([]);
    const p2 = await appendPolicy(pool, app.id, PolicySchema.parse({ framework: 'openspec' }), 'simplify', 'daniel');
    expect(p2.version).toBe(2);
    expect((await currentPolicy(pool, app.id))?.policy.framework).toBe('openspec');
    const list = await listApps(pool);
    expect(list[0]).toMatchObject({ slug: 'checkout', policy_version: 2 });
  });
});
