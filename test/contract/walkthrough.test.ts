import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Server } from 'node:http';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedPacks, packsEmbedder } from '../helpers/seedPacks.js';
import { createHttpApp } from '../../src/mcp/http.js';
import { createLogger } from '../../src/logging.js';
import { createMetrics } from '../../src/metrics.js';
import { createToken } from '../../src/store/tokens.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const run = promisify(execFile);

describe.skipIf(!url)('scripted walkthrough', () => {
  let server: Server;
  let origin: string;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedPacks(pool);
    for (const [name, scopes] of [['host', ['host']], ['approver', ['approver']], ['ci', ['ci']]] as const) {
      tokens[name] = (await createToken(pool, { actor: `walk-${name}`, name, scopes: [...scopes], app_ids: null, expires_at: null }, 'test')).secret;
    }
    const { registry, hooks } = createMetrics();
    // /mcp checks the Host header against allowedHosts, which must include the port.
    const port = 19_000 + Math.floor(Math.random() * 1000);
    const app = createHttpApp({ pool, embedder: packsEmbedder, tokenBudget: 6000, logger: createLogger('silent'), metrics: hooks, registry }, {
      databaseUrl: 'unused', embedding: { provider: 'fake', model: 'fake-1024', ollamaUrl: 'unused' }, listen: { host: '127.0.0.1', port },
      allowedHosts: [`127.0.0.1:${port}`], tokenBudget: 6000, adminToken: null, authMode: 'enforce',
    });
    origin = `http://127.0.0.1:${port}`;
    await new Promise<void>((r) => { server = app.listen(port, '127.0.0.1', () => r()); });
  });
  afterAll(async () => { server.close(); await closeTestPool(); });

  it('passes every row against a server seeded with the packs', async () => {
    // A failing row exits 1; keep its output so the assertion shows which rows failed.
    const { stdout } = await run('node', ['docs/verification/walkthrough.mjs', '--url', origin, '--host-token', tokens.host!, '--approver-token', tokens.approver!, '--ci-token', tokens.ci!])
      .catch((e: { stdout: string }) => ({ stdout: e.stdout }));
    const rows = stdout.trim().split('\n').map((l) => l.split('\t'));
    expect(rows.length, stdout).toBeGreaterThanOrEqual(14);
    expect(rows.filter((r) => r[1] !== 'pass')).toEqual([]);
  });
});
