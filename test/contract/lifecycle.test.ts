import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, textOf, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const proposal = '## Why\nManual.\n\n## What Changes\nButton.\n';
const evidence = { tests: { command: 'npm test', passed: 1, failed: 0 }, lint: 'pass', security: { status: 'skipped', new_high: 0, skipped_reason: 'no scanner' }, files_changed: ['a.ts'] };

describe.skipIf(!url)('lifecycle tools over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('walks a feature to archived with gate failure as a normal result', async () => {
    await withClient('stdio', async (client) => {
      const start = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision, external_ref: 'YAL-9' } }));
      const fid = start.feature_id;
      const fail = await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': 'TODO' }, human_approved: true } });
      expect(fail.isError).toBeUndefined();
      const f = structuredOf<{ result: string; findings: { check: string }[]; next_instructions: string | null }>(fail);
      expect(f.result).toBe('fail');
      expect(f.findings.map((x) => x.check)).toContain('placeholder_scan');
      expect(f.next_instructions).toBeNull();
      expect(JSON.parse(textOf(fail)).result).toBe('fail');
      const pass = structuredOf<{ result: string; next_instructions: string }>(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal }, human_approved: true } }));
      expect(pass.result).toBe('pass');
      expect(pass.next_instructions).toContain('Phase: implement (apply)');
      await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' } });
      const v = structuredOf<{ result: string; findings: { severity: string }[] }>(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence } }));
      expect(v.result).toBe('pass');
      expect(v.findings).toEqual([expect.objectContaining({ severity: 'warning' })]);
      const a = structuredOf<{ feature: { status: string } }>(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' } }));
      expect(a.feature.status).toBe('archived');
      expect(errorOf(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' } })).code).toBe('FEATURE_ARCHIVED');
      const status = structuredOf<{ transitions: unknown[]; status: string; latest_pack_per_phase: Record<string, string> }>(await client.callTool({ name: 'get_feature_status', arguments: { feature_id: fid } }));
      expect(status.status).toBe('archived');
      expect(status.transitions).toHaveLength(5);
      expect(Object.keys(status.latest_pack_per_phase)).toEqual(['specify']);
      const list = structuredOf<{ features: { feature_id: string }[] }>(await client.callTool({ name: 'list_features', arguments: { app: 'checkout', status: ['archived'], external_ref: 'YAL-9' } }));
      expect(list.features.map((x) => x.feature_id)).toEqual([fid]);
      expect(structuredOf<{ features: unknown[] }>(await client.callTool({ name: 'list_features', arguments: { app: 'checkout' } })).features).toEqual([]);
    });
  });

  it('encodes precedence errors: STALE_STATE, PHASE_ORDER_VIOLATION with targets, VALIDATION_ERROR', async () => {
    await withClient('stdio', async (client) => {
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      expect(errorOf(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate' } })).code).toBe('STALE_STATE');
      const order = errorOf(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'verify' } }));
      expect(order).toMatchObject({ code: 'PHASE_ORDER_VIOLATION', details: { forward: ['implement'], backward: [] } });
      const bad = await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'nope', target_phase: 'implement' } }).catch((e: Error) => e);
      // The MCP SDK validates inputSchema before our handler runs, so an invalid enum value never
      // reaches `guarded()` and is not JSON-encoded like our own DomainError results; it resolves as
      // a CallToolResult with isError: true and plain text. Accept any of the three shapes.
      const code = bad instanceof Error ? bad.message : (() => { try { return errorOf(bad).code; } catch { return textOf(bad); } })();
      expect(code).toMatch(/VALIDATION_ERROR|expected_phase|Invalid/);
    });
  });
});
