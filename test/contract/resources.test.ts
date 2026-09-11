import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

function json(r: { contents: ({ text: string } | { blob: string })[] }): Record<string, unknown> {
  const c = r.contents[0]!;
  if (!('text' in c)) throw new Error('expected text content');
  return JSON.parse(c.text);
}

describe.skipIf(!url)('resources over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('lists templates and reads each resource', async () => {
    await withClient('stdio', async (client) => {
      const { resourceTemplates } = await client.listResourceTemplates();
      expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual(['sdd://apps/{slug}', 'sdd://features/{id}', 'sdd://frameworks/{name}', 'sdd://knowledge/{stable_id}', 'sdd://knowledge/{stable_id}/v/{version}']);
      const app = json(await client.readResource({ uri: 'sdd://apps/checkout' }));
      expect(app).toMatchObject({ slug: 'checkout', policy_version: null });
      expect((app.always_on as { stable_id: string }[]).map((i) => i.stable_id)).toEqual(['mini-company.constitution']);
      const fw = json(await client.readResource({ uri: 'sdd://frameworks/mini' }));
      expect(fw).toMatchObject({ name: 'mini', pack_version: '1.0.0' });
      expect(Object.keys(fw.tracks as object)).toEqual(['default']);
      const k = json(await client.readResource({ uri: 'sdd://knowledge/mini.template.proposal' }));
      expect(k).toMatchObject({ stable_id: 'mini.template.proposal', version: 1 });
      const kv = json(await client.readResource({ uri: 'sdd://knowledge/mini.template.proposal/v/1' }));
      expect(kv).toMatchObject({ version: 1 });
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      const f = json(await client.readResource({ uri: `sdd://features/${fid}` }));
      expect(f).toMatchObject({ feature_id: fid, current_phase: 'specify' });
      await expect(client.readResource({ uri: 'sdd://apps/nope' })).rejects.toThrow(/APP_NOT_FOUND/);
      await expect(client.readResource({ uri: 'sdd://knowledge/nope/v/3' })).rejects.toThrow(/KNOWLEDGE_NOT_FOUND/);
      await expect(client.readResource({ uri: 'sdd://knowledge/nope' })).rejects.toThrow(/KNOWLEDGE_NOT_FOUND/);
    });
  });
});
