import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { setEmbeddingConfig } from '../../../src/store/embeddingConfig.js';
import { assertEmbeddingConfigMatches } from '../../../src/embedding/index.js';
import { FakeEmbeddingProvider } from '../../../src/embedding/fake.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('assertEmbeddingConfigMatches', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('passes with no config or a matching config, fails on mismatch', async () => {
    const pool = await getTestPool();
    const fake = new FakeEmbeddingProvider();
    await expect(assertEmbeddingConfigMatches(pool, fake)).resolves.toBeUndefined();
    await setEmbeddingConfig(pool, { provider: 'fake', model: 'fake-1024', dimension: 1024 }, 'cli');
    await expect(assertEmbeddingConfigMatches(pool, fake)).resolves.toBeUndefined();
    await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024 }, 'cli');
    await expect(assertEmbeddingConfigMatches(pool, fake)).rejects.toMatchObject({ code: 'EMBEDDING_MODEL_MISMATCH', message: expect.stringContaining('sdd-admin reindex') });
  });
});
