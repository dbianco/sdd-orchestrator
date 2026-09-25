import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedPacks, packsEmbedder } from '../../helpers/seedPacks.js';
import { EvalFileSchema, runEval } from '../../../src/eval/run.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const run = promisify(execFile);

describe.skipIf(!url)('retrieval eval', () => {
  beforeAll(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedPacks(pool); });
  afterAll(closeTestPool);

  it('runs the seed cases through position-4 retrieval', async () => {
    const cases = EvalFileSchema.parse(parse(await readFile('packs/evals/seed.yaml', 'utf8')));
    expect(cases.length).toBeGreaterThanOrEqual(10);
    const report = await runEval({ q: await getTestPool(), embedder: packsEmbedder }, cases);
    expect(report.cases).toHaveLength(cases.length);
    expect(report.cases.every((c) => !c.degraded)).toBe(true);
    expect(report.recall).toBeGreaterThanOrEqual(0);
    expect(report.mrr).toBeLessThanOrEqual(1);
  });

  it('exits 1 below the thresholds and 0 at zero thresholds', async () => {
    const env = { ...process.env, SDD_DATABASE_URL: url!, SDD_EMBEDDING_PROVIDER: 'fake' };
    const ok = await run('npx', ['tsx', 'src/cli/index.ts', 'eval', 'packs/evals/seed.yaml'], { env });
    expect(JSON.parse(ok.stdout.trim())).toMatchObject({ k: 8, cases: expect.any(Array) });
    await expect(run('npx', ['tsx', 'src/cli/index.ts', 'eval', 'packs/evals/seed.yaml', '--min-recall', '1.01'], { env })).rejects.toMatchObject({ code: 1 });
  });
});
