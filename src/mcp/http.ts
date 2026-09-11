import type { Config } from '../config.js';
import type { McpDeps } from './server.js';

export async function runHttp(_deps: McpDeps, _config: Config): Promise<void> {
  throw new Error('HTTP transport is implemented in Task 42; use --stdio');
}
