import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { GATE_LIBRARY_VERSION } from '../../../src/gates/library.js';
import { ingestPack } from '../../../src/ingest/ingest.js';
import { loadPack } from '../../../src/ingest/load.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { upsertFramework } from '../../../src/store/frameworks.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision, TrackDecl } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const fixture = fileURLToPath(new URL('../../fixtures/packs/mini-framework', import.meta.url));
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const goodProposal = '## Why\nExports are manual.\n\n## What Changes\nAdd a CSV button.\n';
const toImplement = { actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true } as const;

// The mini track with placeholder_scan given a marker that does not compile: what a pack ingested before
// regex params were validated can still hold in the database.
async function brokenTracks(): Promise<Record<string, TrackDecl>> {
  const tracks = structuredClone((await loadPack(fixture)).manifest.tracks!) as Record<string, TrackDecl>;
  tracks.default!.gates[0]!.checks[0] = { name: 'placeholder_scan', params: { markers: ['\\bTODO\\b', '('] } };
  return tracks;
}

describe.skipIf(!url)('a gate whose params do not validate', () => {
  let deps: ServiceDeps;
  let fid: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    deps = { pool, embedder, tokenBudget: 6000 };
    await upsertFramework(pool, { name: 'mini', pack_version: '1.0.0', tracks: await brokenTracks(), gate_library_version: GATE_LIBRARY_VERSION }, 'legacy-ingest');
    fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
  });
  afterAll(closeTestPool);

  it('blocks a feature in its first phase with gate_misconfigured instead of throwing', async () => {
    const r = await advancePhase(deps, { feature_id: fid, ...toImplement });
    expect(r.result).toBe('fail');
    expect(r.feature.current_phase).toBe('specify');
    expect(r.feature.allowed_targets.backward).toEqual([]); // no backward move (and so no repin) is possible here
    expect(r.findings).toEqual([{
      check: 'gate_misconfigured', severity: 'blocker', location: 'placeholder_scan',
      message: expect.stringMatching(/^check placeholder_scan in framework pack mini@1\.0\.0 cannot run: markers\.1 is not a valid regular expression: .*re-ingest the same version/),
    }]);
    const t = (await deps.pool.query(`SELECT result, findings FROM phase_transitions WHERE feature_id = $1`, [fid])).rows;
    expect(t).toEqual([{ result: 'fail', findings: r.findings }]);
  });

  it('is rejected at ingestion, naming the field', async () => {
    const broken = await loadPack(fixture);
    broken.manifest.tracks = await brokenTracks();
    await expect(ingestPack({ pool: deps.pool, embedder }, broken, 'admin')).rejects.toThrow(
      'track default gate specify->implement: check placeholder_scan has invalid params: markers.1 is not a valid regular expression: /(/: Unterminated group',
    );
  });

  it('is repaired in place, in the first phase, by re-ingesting the same pack version', async () => {
    expect((await advancePhase(deps, { feature_id: fid, ...toImplement })).result).toBe('fail');
    await ingestPack({ pool: deps.pool, embedder }, await loadPack(fixture), 'admin'); // the corrected 1.0.0
    const retried = await advancePhase(deps, { feature_id: fid, ...toImplement });
    expect(retried.findings).toEqual([]);
    expect(retried.result).toBe('pass');
    expect(retried.feature).toMatchObject({ current_phase: 'implement', framework_pack_version: '1.0.0' });
  });
});
