import type pg from 'pg';
import { getFrameworkVersion, upsertFramework } from '../../src/store/frameworks.js';
import type { TrackDecl } from '../../src/domain/types.js';

export const FR_REGEX = String.raw`\*\*(?<id>FR-\d{3})\*\*`;

// Adds requirement_ids to the mini pack's spec gate and requirement_coverage out of verify.
export async function withRequirementGates(pool: pg.Pool, coverageSeverity: 'blocker' | 'warning' = 'blocker'): Promise<void> {
  const fw = (await getFrameworkVersion(pool, 'mini', '1.0.0'))!;
  const track = structuredClone(fw.tracks.default) as TrackDecl;
  track.gates.find((g) => g.transition === 'specify->implement')!.checks.push({ name: 'requirement_ids', params: { artifact: 'proposal.md', id_regex: FR_REGEX } });
  track.gates.find((g) => g.transition === 'verify->integrate')!.checks.push({ name: 'requirement_coverage', severity: coverageSeverity });
  await upsertFramework(pool, { name: 'mini', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '2' }, 'seed');
}
