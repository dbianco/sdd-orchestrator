import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/bmad', import.meta.url));

describe('bmad pack', () => {
  it('declares quick and full tracks', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks).sort()).toEqual(['full', 'quick']);
    expect(phaseOrder(tracks.quick!)).toEqual(['specify', 'implement', 'verify', 'integrate']);
    expect(phaseOrder(tracks.full!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
    expect(tracks.quick!.phases.specify).toMatchObject({ alias: 'quick-spec', command: '/bmad-bmm-quick-spec' });
    const quickGate = tracks.quick!.gates.find((g) => g.transition === 'specify->implement')!;
    expect(quickGate.checks.map((c) => c.name)).toEqual(['placeholder_scan', 'required_sections', 'task_done_checks']);
    expect(tracks.full!.gates.find((g) => g.transition === 'specify->plan')!.artifacts).toEqual(['prd.md', 'architecture.md']);
    expect(tracks.full!.gates.find((g) => g.transition === 'learn->archived')!.artifacts).toEqual(['retrospective.md']);
  });
});
