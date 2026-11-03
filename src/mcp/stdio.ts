import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createMcpServer, type McpDeps } from './server.js';

export async function runStdio(deps: McpDeps, transport: Transport = new StdioServerTransport()): Promise<void> {
  const server = createMcpServer(deps);
  await server.connect(transport);
  deps.logger.info('stdio transport connected');
}
