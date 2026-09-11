import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/openspec', import.meta.url));

describe('openspec pack', () => {
  it('declares the three tracks with the spec mappings', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks).sort()).toEqual(['default', 'hotfix', 'refactor']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'implement', 'verify', 'integrate']);
    expect(phaseOrder(tracks.hotfix!)).toEqual(['specify', 'implement', 'verify', 'integrate', 'learn']);
    expect(phaseOrder(tracks.refactor!)).toEqual(['specify', 'implement', 'verify', 'integrate']);
    expect(tracks.hotfix!.spec_review).toBe('deferred');
    expect(tracks.default!.phases.specify).toMatchObject({ alias: 'proposal' });
    expect(tracks.default!.gates.map((g) => g.transition)).toEqual(['specify->implement', 'verify->integrate']);
    const refactorVerify = tracks.refactor!.gates.find((g) => g.transition === 'verify->integrate')!;
    expect(refactorVerify.checks).toEqual([{ name: 'verify_evidence', params: { max_existing_tests_modified: 0 } }]);
  });
});
