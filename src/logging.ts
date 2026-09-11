import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(level = process.env.SDD_LOG_LEVEL ?? 'info'): Logger {
  // fd 2 is stderr: stdout belongs to the stdio transport.
  return pino({ level, base: { service: 'sdd-orchestrator' } }, pino.destination({ dest: 2, sync: false }));
}
