import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const TRANSPORTS = ['stdio', 'http'] as const;
export type TransportMode = (typeof TRANSPORTS)[number];

const env = { ...process.env, SDD_DATABASE_URL: process.env.SDD_TEST_DATABASE_URL!, SDD_EMBEDDING_PROVIDER: 'fake', SDD_LOG_LEVEL: 'warn' };

async function waitForHealth(url: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} did not become healthy`);
}

export interface ClientInfo { baseUrl: string | null }

export async function withClient(mode: TransportMode, fn: (client: Client, info: ClientInfo) => Promise<void>): Promise<void> {
  const client = new Client({ name: 'contract-test', version: '0.0.0' });
  let child: ChildProcess | null = null;
  const info: ClientInfo = { baseUrl: null };
  try {
    if (mode === 'stdio') {
      await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/index.ts', '--stdio'], env, stderr: 'ignore' }));
    } else {
      const port = 18_000 + Math.floor(Math.random() * 1000);
      child = spawn('npx', ['tsx', 'src/index.ts'], { env: { ...env, SDD_LISTEN: `127.0.0.1:${port}`, SDD_ALLOWED_HOSTS: `127.0.0.1:${port},localhost:${port}` }, stdio: 'ignore' });
      info.baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(`${info.baseUrl}/healthz`);
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    }
    await fn(client, info);
  } finally {
    await client.close().catch(() => undefined);
    child?.kill('SIGTERM');
  }
}

export function textOf(result: unknown): string {
  return ((result as CallToolResult).content[0] as { text: string }).text;
}
export function structuredOf<T>(result: unknown): T {
  return (result as CallToolResult).structuredContent as T;
}
export function errorOf(result: unknown): { code: string; message: string; details: Record<string, unknown> } {
  const r = result as CallToolResult;
  if (!r.isError) throw new Error('expected an error result');
  return JSON.parse(textOf(r));
}
