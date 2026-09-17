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

export const VerifyEvidenceParamsSchema = z.object({
  max_new_high: z.number().int().nonnegative().default(0),
  max_existing_tests_modified: z.number().int().nonnegative().nullable().default(null),
});
export type VerifyEvidenceParams = z.infer<typeof VerifyEvidenceParamsSchema>;

export function renderVerifyEvidenceHint(rawParams: Record<string, unknown>): string {
  const params = VerifyEvidenceParamsSchema.parse(rawParams);
  const example: Record<string, unknown> = {
    tests: { command: 'npm test', passed: 42, failed: 0 },
    lint: 'pass',
    security: { status: 'pass', new_high: 0 },
    files_changed: ['src/a.ts'],
    implements: ['FR-1'],
  };
  const lines = [
    'Evidence object shape:',
    '- tests.command (string), tests.passed (number), tests.failed (number)',
    "- lint: 'pass' | 'fail'",
    "- security.status: 'pass' | 'fail' | 'skipped'; security.new_high (number)",
    '- security.skipped_reason is required when security.status is "skipped"',
    '- files_changed (string[]), implements (string[] of requirement/story ids) are optional but expected',
    `- security.new_high: max ${params.max_new_high} new high severity finding(s)`,
  ];
  if (params.max_existing_tests_modified !== null) {
    example.existing_tests_modified = 0;
    example.characterization_tests = ['test/characterize_a.test.ts'];
    lines.push(`- existing_tests_modified (number): max ${params.max_existing_tests_modified} existing test file(s) modified`);
    lines.push('- characterization_tests (must be non-empty): list the characterization tests that cover the preserved behavior');
  }
  lines.push(`Example: ${JSON.stringify(example)}`);
  return lines.join('\n');
}
