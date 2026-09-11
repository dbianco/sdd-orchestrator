import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, textOf, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('start_feature and get_context over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('starts a feature and returns the pack inline', async () => {
    await withClient('stdio', async (client) => {
      const r = await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'daniel', task_description: 'Add CSV export', decision, workspace: { estimated_files: 4 } } });
      const s = structuredOf<{ feature_id: string; pack_id: string; feature: { current_phase: string }; next_instructions: string; context_pack: string }>(r);
      expect(s.feature_id).toMatch(/^f_/);
      expect(s.feature.current_phase).toBe('specify');
      expect(textOf(r)).toBe(s.context_pack);
      expect(textOf(r)).toContain('## Why');
      const ctx = await client.callTool({ name: 'get_context', arguments: { feature_id: s.feature_id, actor: 'daniel', focus: 'ADR-1', scope: 'company' } });
      const c = structuredOf<{ pack_id: string; feature: { feature_id: string } }>(ctx);
      expect(c.pack_id).not.toBe(s.pack_id);
      expect(textOf(ctx)).toContain('# Context pack');
    });
  });

  it('refuses none, unknown framework, missing track and unknown feature', async () => {
    await withClient('stdio', async (client) => {
      const base = { app: 'checkout', actor: 'd', task_description: 'x' };
      expect(errorOf(await client.callTool({ name: 'start_feature', arguments: { ...base, decision: { ...decision, framework: 'none', track: null } } })).code).toBe('VALIDATION_ERROR');
      expect(errorOf(await client.callTool({ name: 'start_feature', arguments: { ...base, decision: { ...decision, framework: 'aiup' } } })).code).toBe('UNKNOWN_FRAMEWORK');
      expect(errorOf(await client.callTool({ name: 'start_feature', arguments: { ...base, decision: { ...decision, track: 'nope' } } })).code).toBe('VALIDATION_ERROR');
      expect(errorOf(await client.callTool({ name: 'get_context', arguments: { feature_id: 'f_nope', actor: 'd' } })).code).toBe('FEATURE_NOT_FOUND');
    });
  });
});
