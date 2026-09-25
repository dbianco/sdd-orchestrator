import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { extractRequirementIds } from '../../../src/gates/checks/requirementIds.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const root = fileURLToPath(new URL('../../../packs/', import.meta.url));

describe('seed packs capture and check requirement ids', () => {
  it.each([
    ['spec-kit', 'default', 'specify->plan', 'spec-kit.template.spec', ['FR-001', 'FR-002'], 'blocker'],
    ['openspec', 'default', 'specify->implement', 'openspec.template.spec', ['<name>'], 'warning'],
    ['bmad', 'full', 'specify->plan', 'bmad.template.prd', ['FR1', 'NFR1'], 'blocker'],
    ['sdlc', 'default', 'specify->plan', 'sdlc.template.prd', ['R1', 'R2'], 'blocker'],
    ['kiro', 'default', 'specify->plan', 'kiro.template.requirements', ['1', '2'], 'blocker'],
  ])('%s %s: the id pattern matches the shipped template and verify checks coverage', async (pack, track, transition, template, ids, coverageSeverity) => {
    const p = await loadPack(`${root}${pack}`);
    const t = (p.manifest.tracks as Record<string, TrackDecl>)[track]!;
    const check = t.gates.find((g) => g.transition === transition)!.checks.find((c) => c.name === 'requirement_ids')!;
    const body = p.items.find((i) => i.frontMatter.id === template)!.body;
    const found = extractRequirementIds(body, (check.params as { id_regex: string }).id_regex).map((r) => r.id);
    expect(found.slice(0, ids.length)).toEqual(ids);
    const coverage = t.gates.find((g) => g.transition === 'verify->integrate')!.checks.find((c) => c.name === 'requirement_coverage')!;
    expect(coverage.severity ?? 'blocker').toBe(coverageSeverity);
  });

  it('declares no requirement checks on refactor, hotfix or quick tracks', async () => {
    for (const [pack, track] of [['openspec', 'hotfix'], ['openspec', 'refactor'], ['spec-kit', 'refactor'], ['bmad', 'quick']] as const) {
      const t = ((await loadPack(`${root}${pack}`)).manifest.tracks as Record<string, TrackDecl>)[track]!;
      expect(t.gates.flatMap((g) => g.checks.map((c) => c.name)).filter((n) => n.startsWith('requirement_'))).toEqual([]);
    }
  });
});
