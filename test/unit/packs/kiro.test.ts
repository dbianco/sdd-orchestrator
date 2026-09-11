import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack, effectiveKind, effectiveFramework } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/kiro', import.meta.url));

describe('kiro pack', () => {
  it('maps requirements, design and tasks and ships EARS as a framework-null standard', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks)).toEqual(['default']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate']);
    expect(tracks.default!.phases.specify).toMatchObject({ alias: 'requirements' });
    const ears = pack.items.find((i) => i.frontMatter.id === 'standard.ears')!;
    expect(effectiveKind(pack, ears)).toBe('standard');
    expect(effectiveFramework(pack, ears)).toBeNull();
    expect(ears.frontMatter.phases).toEqual(['specify']);
  });
});
