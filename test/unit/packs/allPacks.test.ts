import { describe, it, expect } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { validatePack } from '../../../src/ingest/validate.js';

const root = fileURLToPath(new URL('../../../packs/', import.meta.url));

async function packDirs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if (!(await stat(full)).isDirectory()) continue;
    try { await stat(join(full, 'pack.yaml')); out.push(full); } catch { out.push(...(await packDirs(full))); }
  }
  return out.sort();
}

describe('seed packs', () => {
  it('every pack under packs/ loads and validates with no errors', async () => {
    const dirs = await packDirs(root);
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    for (const dir of dirs) {
      const pack = await loadPack(dir);
      const { errors, warnings } = validatePack(pack, { knownAppSlugs: new Set() });
      expect(errors, `${dir} errors`).toEqual([]);
      expect(warnings, `${dir} warnings`).toEqual([]);
      expect(pack.manifest.license, `${dir} license`).not.toBeNull();
    }
  });

  it('company ships one always-on constitution; quality layer and stack guides are retrieved and framework-null', async () => {
    const company = await loadPack(join(root, 'company'));
    expect(company.items.filter((i) => i.frontMatter.tier === 'always_on').map((i) => i.frontMatter.id)).toEqual(['company.constitution']);
    const quality = await loadPack(join(root, 'quality-layer'));
    expect(quality.manifest).toMatchObject({ kind: 'standard', framework: null });
    expect(quality.items.map((i) => i.frontMatter.id).sort()).toEqual(['quality.code-review', 'quality.security-hardening', 'quality.systematic-debugging', 'quality.tdd']);
    const react = await loadPack(join(root, 'stack-guides', 'react'));
    expect(react.manifest).toMatchObject({ name: 'stack-guides/react', kind: 'stack_guide' });
    expect(react.items.every((i) => i.frontMatter.stack_tags.includes('react'))).toBe(true);
  });
});
