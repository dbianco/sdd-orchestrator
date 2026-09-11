import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Registry } from 'prom-client';
import { createMcpServer, type McpDeps } from './server.js';

export interface HttpDeps extends McpDeps { registry: Registry }

export function createHttpApp(deps: HttpDeps, config: Config): Express {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const handle = async (req: Request, res: Response) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts: config.allowedHosts,
    });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      deps.logger.error({ err: e }, 'mcp request failed');
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
    }
  };
  app.post('/mcp', handle);
  app.get('/mcp', handle);
  app.delete('/mcp', handle);

  app.get('/healthz', async (_req, res) => {
    let database = 'ok';
    try { await deps.pool.query('SELECT 1'); } catch { database = 'unreachable'; }
    const embedding = deps.embedder ? ((await deps.embedder.healthy()) ? 'ok' : 'unreachable') : 'disabled';
    const status = database === 'ok' ? 'ok' : 'degraded';
    res.status(database === 'ok' ? 200 : 503).json({ status, database, embedding });
  });

  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', deps.registry.contentType);
    res.send(await deps.registry.metrics());
  });

  return app;
}

export async function runHttp(deps: HttpDeps, config: Config): Promise<void> {
  const app = createHttpApp(deps, config);
  await new Promise<void>((resolve) => {
    app.listen(config.listen.port, config.listen.host, () => {
      deps.logger.info({ host: config.listen.host, port: config.listen.port }, 'streamable http listening');
      resolve();
    });
  });
}
