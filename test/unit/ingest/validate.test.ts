import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack, type LoadedPack } from '../../../src/ingest/load.js';
import { validatePack } from '../../../src/ingest/validate.js';

const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const ctx = { knownAppSlugs: new Set(['checkout']) };

function clone(p: LoadedPack): LoadedPack { return structuredClone(p); }

describe('validatePack', () => {
  it('accepts the fixture packs', async () => {
    expect(validatePack(await loadPack(`${fixtures}mini-framework`), ctx)).toEqual({ errors: [], warnings: [] });
    expect(validatePack(await loadPack(`${fixtures}mini-company`), ctx)).toEqual({ errors: [], warnings: [] });
  });
  it('rejects duplicate ids', async () => {
    const p = clone(await loadPack(`${fixtures}mini-framework`));
    p.items.push({ ...p.items[0]!, sourcePath: 'dup.md' });
    expect(validatePack(p, ctx).errors).toContain('duplicate id "mini.guide.proposals" (guides/writing-proposals.md, dup.md)');
  });
  it('rejects always_on on a non-standard, app_memory without app or memory_type, unknown app', async () => {
    const p = clone(await loadPack(`${fixtures}mini-framework`));
    p.items[0]!.frontMatter.tier = 'always_on';
    p.items[1]!.frontMatter.kind = 'app_memory';
    p.items[2]!.frontMatter.kind = 'app_memory';
    p.items[2]!.frontMatter.app = 'nope';
    p.items[2]!.frontMatter.memory_type = 'adr';
    const { errors } = validatePack(p, ctx);
    expect(errors).toContain('mini.guide.proposals: only standard items may be always_on');
    expect(errors).toContain('mini.template.apply: app_memory items require app');
    expect(errors).toContain('mini.template.apply: app_memory items require memory_type');
    expect(errors).toContain('mini.template.proposal: unknown app "nope"');
  });
  it('rejects framework packs with bad tracks', async () => {
    const p = clone(await loadPack(`${fixtures}mini-framework`));
    const track = p.manifest.tracks!.default!;
    track.phases.verify = 'skipped';
    track.gates[0]!.checks.push({ name: 'nope' });
    track.phases.implement = { alias: 'apply', template: 'mini.template.missing' };
    const { errors } = validatePack(p, ctx);
    expect(errors).toContain('track default: phase verify is mandatory and cannot be skipped');
    expect(errors).toContain('track default gate specify->implement: unknown check "nope"');
    expect(errors).toContain('track default: phase implement names template "mini.template.missing" which is not in this pack');
    const noTracks = clone(await loadPack(`${fixtures}mini-framework`));
    delete noTracks.manifest.tracks;
    expect(validatePack(noTracks, ctx).errors).toContain('framework packs must declare tracks');
  });
  it('warns on oversized always-on standards and templates', async () => {
    const p = clone(await loadPack(`${fixtures}mini-company`));
    p.items[0]!.body = 'word '.repeat(1300);
    expect(validatePack(p, ctx).warnings[0]).toMatch(/always-on standards for company total \d+ tokens, above 1200/);
    const f = clone(await loadPack(`${fixtures}mini-framework`));
    f.items.find((i) => i.frontMatter.id === 'mini.template.proposal')!.body = 'word '.repeat(3200);
    expect(validatePack(f, ctx).warnings[0]).toMatch(/template mini.template.proposal is \d+ tokens, above 3000/);
  });
});
