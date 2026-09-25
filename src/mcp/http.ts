import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Registry } from 'prom-client';
import type { AuthContext } from '../auth/context.js';
import { createAdminRouter } from '../web/adminRoutes.js';
import { createCiRouter } from '../web/ciRoutes.js';
import { mcpAuth } from '../web/mcpAuth.js';
import { createMcpServer, type McpDeps } from './server.js';

export interface HttpDeps extends McpDeps { registry: Registry }

export function createHttpApp(baseDeps: HttpDeps, config: Config): Express {
  const deps: HttpDeps = { ...baseDeps, authMode: config.authMode };
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: invalid JSON body' }, id: null });
      return;
    }
    next(err);
  });

  const handle = async (req: Request, res: Response) => {
    const server = createMcpServer(deps, res.locals.auth as AuthContext);
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
  const auth = mcpAuth(deps, config.authMode);
  app.post('/mcp', auth, handle);
  app.get('/mcp', auth, handle);
  app.delete('/mcp', auth, handle);

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

  if (config.authMode !== 'off') app.use('/api/ci', createCiRouter(deps));

  // Personal approver tokens can log in whenever auth is on; SDD_ADMIN_TOKEN alone still enables a read-only admin.
  if (config.adminToken || config.authMode !== 'off') app.use('/admin', createAdminRouter(deps, config.adminToken));

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
