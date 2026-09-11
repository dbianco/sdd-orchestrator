import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { DomainError, isDomainError } from '../errors.js';
import type { Logger } from '../logging.js';

export function okResult<T extends Record<string, unknown>>(structured: T, text: string): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

export function errorResult(err: DomainError): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(err.toJSON()) }], isError: true };
}

export async function guarded<T extends Record<string, unknown>>(
  logger: Logger, tool: string, fn: () => Promise<{ structured: T; text: string }>,
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const { structured, text } = await fn();
    logger.info({ tool, duration_ms: Date.now() - started, ok: true }, 'tool call');
    return okResult(structured, text);
  } catch (e) {
    if (isDomainError(e)) {
      logger.info({ tool, duration_ms: Date.now() - started, ok: false, code: e.code }, 'tool call failed');
      return errorResult(e);
    }
    if (e instanceof ZodError) {
      const err = new DomainError('VALIDATION_ERROR', e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), {
        issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return errorResult(err);
    }
    logger.error({ tool, err: e }, 'tool call crashed');
    throw e;
  }
}
