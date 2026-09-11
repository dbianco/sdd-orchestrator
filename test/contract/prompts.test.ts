import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('prompts over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('exposes one prompt per phase returning the pack persisted as prompt', async () => {
    await withClient('stdio', async (client) => {
      const { prompts } = await client.listPrompts();
      expect(prompts.map((p) => p.name).sort()).toEqual(['sdd.implement', 'sdd.integrate', 'sdd.learn', 'sdd.plan', 'sdd.specify', 'sdd.tasks', 'sdd.verify']);
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      const p = await client.getPrompt({ name: 'sdd.specify', arguments: { feature_id: fid } });
      const text = (p.messages[0]!.content as { text: string }).text;
      expect(text).toContain('# Context pack');
      expect(text).toContain('Phase: specify (proposal)');
      const pool = await getTestPool();
      const rows = (await pool.query(`SELECT created_by FROM context_packs WHERE feature_id = $1 ORDER BY created_at`, [fid])).rows;
      expect(rows.map((r) => r.created_by)).toEqual(['d', 'prompt']);
      await expect(client.getPrompt({ name: 'sdd.plan', arguments: { feature_id: fid } })).rejects.toThrow(/VALIDATION_ERROR/);
    });
  });
});
