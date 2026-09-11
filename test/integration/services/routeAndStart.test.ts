import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { routeTask } from '../../../src/services/routeTask.js';
import { startFeature } from '../../../src/services/startFeature.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('routeTask and startFeature', () => {
  let deps: ServiceDeps;
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); deps = { pool, embedder, tokenBudget: 6000 }; });
  afterAll(closeTestPool);

  it('routes without writing and attaches layers', async () => {
    const r = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false, stack: ['react'] }, framework_preference: 'mini' });
    expect(r.decision).toMatchObject({ framework: 'mini', track: 'default', rule: '2-preference', framework_pack_version: '1.0.0', policy_version: null });
    expect(r.attached_layers).toEqual([
      { pack_name: 'quality-layer', pack_version: '1.0.0', kind: 'standard' },
      { pack_name: 'stack-guides/react', pack_version: '1.0.0', kind: 'stack_guide' },
    ]);
    expect(r.lite_pack).toBeNull();
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM context_packs')).rows[0].n).toBe(0);
  });

  it('returns a lite pack for trivial work', async () => {
    const r = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1, paths_touched: ['src/a.tsx'], stack: ['react'] } });
    expect(r.decision).toMatchObject({ intent: 'trivial', framework: 'none', rule: '4-trivial' });
    expect(r.lite_pack?.rendered).toContain('[mini-company.constitution v1]');
    expect(r.lite_pack?.rendered).toContain('- Never change tax rounding');
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM context_packs')).rows[0].n).toBe(0);
  });

  it('fails on unknown app and unknown preference', async () => {
    await expect(routeTask(deps, { task_description: 'x', app: 'nope', workspace: {} })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
    await expect(routeTask(deps, { task_description: 'x', app: 'checkout', workspace: {}, framework_preference: 'aiup' })).rejects.toMatchObject({ code: 'UNKNOWN_FRAMEWORK' });
  });

  it('starts a feature pinned to the current framework version with the specify pack', async () => {
    const r = await routeTask(deps, { task_description: 'Add CSV export to the orders page', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' });
    const s = await startFeature(deps, { app: 'checkout', actor: 'daniel', task_description: 'Add CSV export to the orders page', decision: r.decision, workspace: { estimated_files: 4 }, external_ref: 'YAL-123' });
    expect(s.feature_id).toMatch(/^f_/);
    expect(s.feature).toMatchObject({ framework: 'mini', framework_pack_version: '1.0.0', track: 'default', current_phase: 'specify', phase_alias: 'proposal', status: 'active', external_ref: 'YAL-123', slug: 'yal-123-add-csv-export-to-the-orders-page' });
    expect(s.feature.allowed_targets).toEqual({ forward: ['implement'], backward: [] });
    expect(s.context_pack).toContain('## Why');
    expect(s.next_instructions).toContain(`Keep the feature id ${s.feature_id}`);
    expect(s.pack_id).toMatch(/^cp_/);
    expect(s.warnings).toEqual([]);
    const row = (await deps.pool.query('SELECT * FROM features WHERE id = $1', [s.feature_id])).rows[0];
    expect(row.decision.rule).toBe('2-preference');
    expect(row.created_by).toBe('daniel');
  });

  it('refuses framework none, unknown framework, missing track and policy override without reason', async () => {
    const base = { app: 'checkout', actor: 'daniel', task_description: 'x' };
    const dec = (over: Record<string, unknown>) => ({ intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0', ...over }) as never;
    await expect(startFeature(deps, { ...base, decision: dec({ framework: 'none', track: null }) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(startFeature(deps, { ...base, decision: dec({ framework: 'aiup' }) })).rejects.toMatchObject({ code: 'UNKNOWN_FRAMEWORK' });
    await expect(startFeature(deps, { ...base, decision: dec({ track: 'nope' }) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await deps.pool.query(`INSERT INTO app_policies (id, app_id, version, policy, reason, created_by) SELECT 'pol_1', id, 1, '{"framework":"spec-kit","path_rules":[],"risk_paths":[]}', 'r', 'seed' FROM apps WHERE slug = 'checkout'`);
    await expect(startFeature(deps, { ...base, decision: dec({}) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('policy_override_reason') });
    const ok = await startFeature(deps, { ...base, decision: dec({}), policy_override_reason: 'spec-kit pack not ingested here' });
    expect(ok.feature.framework).toBe('mini');
  });

  it('warns when the decision names a stale pack version', async () => {
    const dec: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '0.9.0' };
    const s = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision: dec });
    expect(s.feature.framework_pack_version).toBe('1.0.0');
    expect(s.warnings[0]).toMatch(/decision named pack version 0.9.0; pinned 1.0.0/);
  });
});
