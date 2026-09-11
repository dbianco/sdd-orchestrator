import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack, effectiveKind, effectiveFramework } from '../../../src/ingest/load.js';
import { PackManifestSchema, FrontMatterSchema } from '../../../src/ingest/schema.js';

const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));

describe('loadPack', () => {
  it('loads the manifest and every markdown item with hashes', async () => {
    const pack = await loadPack(`${fixtures}mini-framework`);
    expect(pack.manifest.name).toBe('mini');
    expect(Object.keys(pack.manifest.tracks ?? {})).toEqual(['default']);
    expect(pack.items.map((i) => i.frontMatter.id)).toEqual(['mini.guide.proposals', 'mini.template.apply', 'mini.template.proposal']);
    const proposal = pack.items.find((i) => i.frontMatter.id === 'mini.template.proposal')!;
    expect(proposal.body.startsWith('## Why')).toBe(true);
    expect(proposal.sourcePath).toBe('templates/proposal.md');
    expect(proposal.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(effectiveKind(pack, proposal)).toBe('framework_pack');
    expect(effectiveFramework(pack, proposal)).toBe('mini');
  });
  it('applies front matter defaults', () => {
    const fm = FrontMatterSchema.parse({ id: 'x', title: 'X' });
    expect(fm).toMatchObject({ tier: 'retrieved', phases: [], stack_tags: [] });
  });
  it('rejects a manifest without a semver version', () => {
    expect(PackManifestSchema.safeParse({ name: 'x', kind: 'standard', version: 'v1' }).success).toBe(false);
  });
  it('fails clearly when pack.yaml is missing', async () => {
    await expect(loadPack(`${fixtures}nope`)).rejects.toThrow(/pack\.yaml/);
  });
});
