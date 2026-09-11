import type { z } from 'zod';
import type { Finding, Severity, VerifyEvidence } from '../domain/types.js';

export interface CheckInput {
  artifacts: Record<string, string>;
  declaredArtifacts: string[];
  evidence: VerifyEvidence | Record<string, unknown> | null;
  human_approved: boolean;
  params: Record<string, unknown>;
  severity: Severity;
}

export type CheckFn = (input: CheckInput) => Finding[];

export interface CheckDefinition {
  name: string;
  defaultSeverity: Severity;
  params: z.ZodTypeAny;
  run: CheckFn;
}

export function finding(check: string, severity: Severity, location: string | null, message: string): Finding {
  return { check, severity, location, message };
}
