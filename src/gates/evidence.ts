import { z } from 'zod';

export const VerifyEvidenceSchema = z.object({
  tests: z.object({ command: z.string(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }),
  lint: z.enum(['pass', 'fail']),
  security: z.object({
    status: z.enum(['pass', 'fail', 'skipped']),
    new_high: z.number().int().nonnegative(),
    skipped_reason: z.string().nullable().optional(),
  }),
  files_changed: z.array(z.string()).optional(),
  implements: z.array(z.string()).optional(),
  existing_tests_modified: z.number().int().nonnegative().optional(),
  characterization_tests: z.array(z.string()).optional(),
});
