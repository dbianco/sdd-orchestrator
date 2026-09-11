import { describe, it, expect } from 'vitest';
import { okResult, errorResult, guarded } from '../../../src/mcp/encode.js';
import { DomainError } from '../../../src/errors.js';
import { z } from 'zod';

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => logger } as never;

describe('encode', () => {
  it('okResult carries structuredContent and one text block', () => {
    const r = okResult({ a: 1, warnings: [] }, 'hello');
    expect(r.structuredContent).toEqual({ a: 1, warnings: [] });
    expect(r.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(r.isError).toBeUndefined();
  });
  it('errorResult encodes the domain error as JSON text', () => {
    const r = errorResult(new DomainError('STALE_STATE', 'stale', { current_phase: 'plan' }));
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ code: 'STALE_STATE', message: 'stale', details: { current_phase: 'plan' } });
  });
  it('guarded maps DomainError and ZodError, rethrows others', async () => {
    const dom = await guarded(logger, 't', async () => { throw new DomainError('APP_NOT_FOUND', 'x'); });
    expect(dom.isError).toBe(true);
    const zod = await guarded(logger, 't', async () => { z.object({ a: z.string() }).parse({}); return { structured: {}, text: '' }; });
    expect(JSON.parse((zod.content[0] as { text: string }).text)).toMatchObject({ code: 'VALIDATION_ERROR', details: { issues: [expect.objectContaining({ path: 'a' })] } });
    await expect(guarded(logger, 't', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
