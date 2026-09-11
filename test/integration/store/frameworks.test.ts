import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { upsertFramework, currentFramework, listCurrentFrameworks, deprecateFramework, trackOf, compareSemver, getFrameworkVersion } from '../../../src/store/frameworks.js';
import { getEmbeddingConfig, setEmbeddingConfig } from '../../../src/store/embeddingConfig.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const track: TrackDecl = { phases: { specify: {}, plan: 'skipped', tasks: 'skipped', implement: {}, verify: {}, integrate: {}, learn: 'skipped' }, gates: [] };

describe.skipIf(!url)('frameworks', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('orders versions by semver and reports the current one', async () => {
    const pool = await getTestPool();
    await upsertFramework(pool, { name: 'openspec', pack_version: '1.9.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    await upsertFramework(pool, { name: 'openspec', pack_version: '1.10.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    expect((await currentFramework(pool, 'openspec'))?.pack_version).toBe('1.10.0');
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('re-upserting the same version replaces tracks', async () => {
    const pool = await getTestPool();
    await upsertFramework(pool, { name: 'x', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    await upsertFramework(pool, { name: 'x', pack_version: '1.0.0', tracks: { default: track, hotfix: track }, gate_library_version: '1' }, 'cli');
    const row = await getFrameworkVersion(pool, 'x', '1.0.0');
    expect(Object.keys(row!.tracks)).toEqual(['default', 'hotfix']);
    expect(trackOf(row!, null).phases.plan).toBe('skipped');
    expect(() => trackOf(row!, 'nope')).toThrow(expect.objectContaining({ code: 'UNKNOWN_FRAMEWORK' }));
  });

  it('deprecation removes a version or all versions from current', async () => {
    const pool = await getTestPool();
    await upsertFramework(pool, { name: 'kiro', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    await upsertFramework(pool, { name: 'kiro', pack_version: '1.1.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    expect(await deprecateFramework(pool, 'kiro', '1.1.0', 'bad', 'cli')).toBe(1);
    expect((await currentFramework(pool, 'kiro'))?.pack_version).toBe('1.0.0');
    expect(await deprecateFramework(pool, 'kiro', null, 'unused', 'cli')).toBe(1);
    expect(await currentFramework(pool, 'kiro')).toBeNull();
    expect((await listCurrentFrameworks(pool)).map((f) => f.name)).toEqual([]);
  });
});

describe.skipIf(!url)('embedding config', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('is a single row that can be replaced', async () => {
    const pool = await getTestPool();
    expect(await getEmbeddingConfig(pool)).toBeNull();
    await setEmbeddingConfig(pool, { provider: 'fake', model: 'fake-1024', dimension: 1024 }, 'cli');
    const c = await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024, reindexed: true }, 'cli');
    expect(c.model).toBe('voyage-3.5');
    expect(c.reindexed_at).not.toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM embedding_config')).rows[0].n).toBe(1);
  });
});
