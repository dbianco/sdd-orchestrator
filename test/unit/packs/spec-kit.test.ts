import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/spec-kit', import.meta.url));

describe('spec-kit pack', () => {
  it('maps all seven phases one to one and declares scope_drift on verify', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks).sort()).toEqual(['default', 'refactor']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
    expect(tracks.default!.phases.learn).toMatchObject({ alias: 'reconcile' });
    const verify = tracks.default!.gates.find((g) => g.transition === 'verify->integrate')!;
    expect(verify.artifacts).toEqual(['plan.md']);
    expect(verify.checks.map((c) => c.name)).toEqual(['verify_evidence', 'scope_drift']);
    const refactorSpecify = tracks.refactor!.gates.find((g) => g.transition === 'specify->plan')!;
    expect(refactorSpecify.checks[1]).toMatchObject({ name: 'required_sections', params: { sections: ['Observed Behaviors', 'Assumed Contracts', 'Characterization Tests'] } });
    expect(pack.items.some((i) => i.frontMatter.id === 'spec-kit.template.refactor-spec')).toBe(true);
  });
});
