import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, type McpDeps } from './server.js';

export async function runStdio(deps: McpDeps): Promise<void> {
  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
  deps.logger.info('stdio transport connected');
}
