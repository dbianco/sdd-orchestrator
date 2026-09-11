import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/sdlc', import.meta.url));

describe('sdlc pack', () => {
  it('maps the house flow', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks)).toEqual(['default']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
    expect(tracks.default!.phases.plan).toMatchObject({ alias: 'jot-down' });
    expect(tracks.default!.phases.verify).toMatchObject({ alias: 'implement-task' });
    expect(tracks.default!.gates.find((g) => g.transition === 'specify->plan')!.artifacts).toEqual(['prd.md', 'scoping.md']);
    const tasksGate = tracks.default!.gates.find((g) => g.transition === 'tasks->implement')!;
    expect(tasksGate.checks.map((c) => c.name)).toEqual(['placeholder_scan', 'task_ordering', 'task_done_checks']);
  });
});
