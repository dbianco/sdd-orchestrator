import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf, errorOf, textOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('memory tools over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('searches with scope and proposes memory', async () => {
    await withClient('stdio', async (client) => {
      const s = structuredOf<{ chunks: { stable_id: string; match: string }[]; degraded: boolean }>(await client.callTool({ name: 'search_memory', arguments: { query: 'failing test first', app: 'checkout', kinds: ['standard'], limit: 3 } }));
      expect(s.degraded).toBe(false);
      expect(s.chunks.map((c) => c.stable_id)).toContain('quality.tdd');
      expect(s.chunks.length).toBeLessThanOrEqual(3);
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      const proposeResult = await client.callTool({ name: 'propose_memory', arguments: { feature_id: fid, actor: 'd', kind: 'app_memory', memory_type: 'adr', title: 'ADR-9 Stream exports', body: 'Stream.', links: ['archive/x'] } });
      const p = structuredOf<{ proposal_id: string; status: string }>(proposeResult);
      expect(p).toEqual({ proposal_id: expect.stringMatching(/^p_/), status: 'pending' });
      expect(textOf(proposeResult)).toContain('\n');
      expect(errorOf(await client.callTool({ name: 'propose_memory', arguments: { feature_id: fid, actor: 'd', kind: 'app_memory', title: 't', body: 'b' } })).code).toBe('VALIDATION_ERROR');
      expect(errorOf(await client.callTool({ name: 'search_memory', arguments: { query: 'x', app: 'checkout', scope: ['nope'] } })).code).toBe('APP_NOT_FOUND');
    });
  });
});
