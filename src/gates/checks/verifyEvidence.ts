import { z } from 'zod';
import { VerifyEvidenceSchema } from '../evidence.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({
  max_new_high: z.number().int().nonnegative().default(0),
  max_existing_tests_modified: z.number().int().nonnegative().nullable().default(null),
});

export const verifyEvidence: CheckDefinition = {
  name: 'verify_evidence',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ evidence, params, severity }) => {
    const p = Params.parse(params);
    const name = 'verify_evidence';
    if (!evidence) return [finding(name, 'blocker', null, 'evidence is required on the transition out of verify')];
    const parsed = VerifyEvidenceSchema.safeParse(evidence);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => finding(name, 'blocker', i.path.join('.'), `evidence field ${i.path.join('.')} is invalid or missing: ${i.message}`));
    }
    const e = parsed.data;
    const out = [];
    if (e.tests.failed > 0) out.push(finding(name, severity, 'tests.failed', `${e.tests.failed} tests failed`));
    if (e.lint === 'fail') out.push(finding(name, severity, 'lint', 'lint failed'));
    if (e.security.status === 'fail') out.push(finding(name, severity, 'security.status', 'security scan failed'));
    if (e.security.status === 'pass' && e.security.new_high > p.max_new_high) {
      out.push(finding(name, severity, 'security.new_high', `${e.security.new_high} new high severity finding(s), max ${p.max_new_high}`));
    }
    if (e.security.status === 'skipped') {
      if (e.security.skipped_reason) out.push(finding(name, 'warning', 'security', `security scan skipped: ${e.security.skipped_reason}`));
      else out.push(finding(name, 'blocker', 'security.skipped_reason', 'security.skipped_reason is required when status is skipped'));
    }
    if (p.max_existing_tests_modified !== null) {
      if (e.existing_tests_modified === undefined) {
        out.push(finding(name, 'blocker', 'existing_tests_modified', 'existing_tests_modified is required by this track'));
      } else if (e.existing_tests_modified > p.max_existing_tests_modified) {
        out.push(finding(name, severity, 'existing_tests_modified', `${e.existing_tests_modified} existing test file(s) modified, max ${p.max_existing_tests_modified}`));
      }
      if (!e.characterization_tests || e.characterization_tests.length === 0) {
        out.push(finding(name, 'blocker', 'characterization_tests', 'characterization_tests must be non-empty'));
      }
    }
    return out;
  },
};
