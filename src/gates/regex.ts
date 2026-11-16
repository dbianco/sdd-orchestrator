import { z } from 'zod';

/** Why `pattern` does not compile with `flags`, or null when it does. */
export function regexError(pattern: string, flags = ''): string | null {
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).replace(/^Invalid regular expression:\s*/, '');
  }
}

/**
 * A gate param holding a regular expression. It must compile with the flags the check uses at run time,
 * so a bad pattern fails pack validation at ingestion instead of throwing a SyntaxError during a phase move.
 * The issue is fatal: group-name refinements chained after it are not run on a pattern that does not compile.
 * The path of the issue names the field (`task_regex`, `markers.1`, ...); validateGateDecl prefixes it.
 * The return type is inferred on purpose: zod 3 wraps it in ZodEffects, zod 4 keeps a ZodString.
 */
export function regexParam(flags = '') {
  return z.string().superRefine((pattern, ctx) => {
    const error = regexError(pattern, flags);
    if (error !== null) ctx.addIssue({ code: 'custom', message: `is not a valid regular expression: ${error}`, fatal: true });
  });
}
