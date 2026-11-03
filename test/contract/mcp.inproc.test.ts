import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll, embedder } from '../helpers/seed.js';
import { createMcpServer, type McpDeps } from '../../src/mcp/server.js';
import { runStdio } from '../../src/mcp/stdio.js';
import { createLogger } from '../../src/logging.js';
import { appendPolicy } from '../../src/store/policies.js';
import { approveProposal } from '../../src/services/approveProposal.js';
import { insertProposal } from '../../src/store/proposals.js';
import type { AuthContext } from '../../src/auth/context.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const text = (r: { contents: ({ text: string } | { blob: string })[] }) => JSON.parse((r.contents[0] as { text: string }).text) as Record<string, unknown>;
const structured = <T>(r: unknown) => (r as CallToolResult).structuredContent as T;
const errorOf = (r: unknown) => JSON.parse(((r as CallToolResult).content[0] as { text: string }).text) as { code: string; message: string };

describe.skipIf(!url)('MCP server in-process', () => {
  let deps: McpDeps;
  let client: Client;
  const connect = async (auth?: AuthContext) => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps, auth).connect(a);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
  };
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); deps = { pool, embedder, tokenBudget: 6000, logger: createLogger('silent') }; });
  afterEach(async () => { await client?.close().catch(() => undefined); });
  afterAll(closeTestPool);

  it('reads every resource and reports domain errors as readable messages', async () => {
    await connect();
    const fid = structured<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
    expect(text(await client.readResource({ uri: 'sdd://apps/checkout' }))).toMatchObject({ slug: 'checkout', policy_version: null });
    expect(text(await client.readResource({ uri: 'sdd://apps/checkout/rtm' }))).toEqual({ app: 'checkout', rows: [] });
    expect(text(await client.readResource({ uri: `sdd://features/${fid}` }))).toMatchObject({ feature_id: fid });
    expect(text(await client.readResource({ uri: 'sdd://frameworks/mini' }))).toMatchObject({ name: 'mini' });
    expect(text(await client.readResource({ uri: 'sdd://knowledge/mini.template.proposal' }))).toMatchObject({ version: 1 });
    expect(text(await client.readResource({ uri: 'sdd://knowledge/mini.template.proposal/v/1' }))).toMatchObject({ version: 1 });
    await expect(client.readResource({ uri: 'sdd://apps/nope' })).rejects.toThrow(/APP_NOT_FOUND/);
    await expect(client.readResource({ uri: 'sdd://apps/nope/rtm' })).rejects.toThrow(/APP_NOT_FOUND/);
    await expect(client.readResource({ uri: 'sdd://features/f_nope' })).rejects.toThrow(/FEATURE_NOT_FOUND/);
    await expect(client.readResource({ uri: 'sdd://frameworks/nope' })).rejects.toThrow(/./);
    await expect(client.readResource({ uri: 'sdd://knowledge/nope' })).rejects.toThrow(/KNOWLEDGE_NOT_FOUND/);
    await expect(client.readResource({ uri: 'sdd://knowledge/nope/v/3' })).rejects.toThrow(/KNOWLEDGE_NOT_FOUND/);
    await expect(client.readResource({ uri: 'sdd://knowledge/mini.template.proposal/v/99' })).rejects.toThrow(/KNOWLEDGE_NOT_FOUND/);
  });

  it('reads an app profile with a policy and an app-scoped knowledge item', async () => {
    await connect();
    const appId = (await deps.pool.query<{ id: string }>(`SELECT id FROM apps WHERE slug = 'checkout'`)).rows[0]!.id;
    await appendPolicy(deps.pool, appId, { framework: null, path_rules: [], risk_paths: [] } as never, 'test', 'seed');
    expect(text(await client.readResource({ uri: 'sdd://apps/checkout' }))).toMatchObject({ policy_version: 1 });
    const fid = structured<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
    const pid = (await insertProposal(deps.pool, { app_id: appId, feature_id: fid, payload: { kind: 'app_memory', memory_type: 'decision', title: 'Stream', body: 'Stream rows.', stack_tags: [], links: [] }, supersedes: null }, 'agent')).id;
    const item = await approveProposal({ pool: deps.pool, embedder }, pid, 'erin');
    expect(text(await client.readResource({ uri: `sdd://knowledge/${item.stable_id}` }))).toMatchObject({ stable_id: item.stable_id });
    expect(text(await client.readResource({ uri: `sdd://knowledge/${item.stable_id}/v/1` }))).toMatchObject({ version: 1 });
  });

  it('serves phase prompts and refuses unknown features', async () => {
    await connect();
    const fid = structured<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toContain('sdd.specify');
    const prompt = await client.getPrompt({ name: 'sdd.specify', arguments: { feature_id: fid } });
    expect((prompt.messages[0]!.content as { text: string }).text).toContain('Phase: specify');
    await expect(client.getPrompt({ name: 'sdd.plan', arguments: { feature_id: 'f_nope' } })).rejects.toThrow(/FEATURE_NOT_FOUND/);
  });

  it('refuses resources and prompts outside a restricted token\'s apps', async () => {
    await connect();
    const fid = structured<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
    await client.close();
    await connect({ kind: 'token', token_id: 'tk_1', actor: 'bob', scopes: ['host'], app_ids: ['app_other'] });
    await expect(client.readResource({ uri: 'sdd://apps/checkout' })).rejects.toThrow(/FORBIDDEN/);
    await expect(client.readResource({ uri: 'sdd://apps/checkout/rtm' })).rejects.toThrow(/FORBIDDEN/);
    await expect(client.readResource({ uri: `sdd://features/${fid}` })).rejects.toThrow(/FORBIDDEN/);
    await expect(client.getPrompt({ name: 'sdd.specify', arguments: { feature_id: fid } })).rejects.toThrow(/FORBIDDEN/);
    expect(errorOf(await client.callTool({ name: 'list_features', arguments: { app: 'checkout' } })).code).toBe('FORBIDDEN');
  });

  it('exposes the memory and status tools, with errors as tool results', async () => {
    await connect();
    const started = structured<{ feature_id: string; routing_id?: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'CSV export', decision } }));
    const fid = started.feature_id;
    const proposed = structured<{ proposal_id: string }>(await client.callTool({ name: 'propose_memory', arguments: { feature_id: fid, actor: 'd', kind: 'app_memory', memory_type: 'decision', title: 'T', body: 'B' } }));
    expect(proposed.proposal_id).toMatch(/^p_/);
    expect(errorOf(await client.callTool({ name: 'propose_memory', arguments: { feature_id: 'f_nope', actor: 'd', kind: 'standard', title: 'T', body: 'B' } })).code).toBe('FEATURE_NOT_FOUND');
    expect(structured<{ feature_id: string }>(await client.callTool({ name: 'get_feature_status', arguments: { feature_id: fid } })).feature_id).toBe(fid);
    expect(structured<{ features: unknown[] }>(await client.callTool({ name: 'list_features', arguments: { app: 'checkout' } })).features).toHaveLength(1);
    expect(structured<{ chunks: unknown[] }>(await client.callTool({ name: 'search_memory', arguments: { query: 'csv export', app: 'checkout', scope: 'app' } })).chunks).toBeDefined();
    expect(errorOf(await client.callTool({ name: 'get_context', arguments: { feature_id: 'f_nope' } })).code).toBe('VALIDATION_ERROR');
    const routed = structured<{ routing_id: string }>(await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'checkout', workspace: {}, framework_preference: 'mini' } }));
    expect(routed.routing_id).toMatch(/^r_/);
    const spike = await client.callTool({ name: 'route_task', arguments: { task_description: 'Can we cache?', app: 'checkout', workspace: { intent: 'spike' } } });
    expect(((spike as CallToolResult).content[0] as { text: string }).text).toMatch(/Prototype first/);
    expect(errorOf(await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'ghost', workspace: {} } })).code).toBe('APP_NOT_FOUND');
  });

  it('runStdio connects the server to the transport it is given', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await runStdio(deps, a);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('route_task');
  });
});
