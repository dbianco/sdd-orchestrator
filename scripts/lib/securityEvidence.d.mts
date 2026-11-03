export interface Finding { key: string; text: string }
export interface Baseline { version: number; generated_at: string; findings: Record<string, number> }
export function trivyHigh(report: unknown): Finding[];
export function opengrepHigh(report: unknown): Finding[];
export function makeBaseline(findings: Finding[], now?: Date): Baseline;
export function newFindings(findings: Finding[], baseline: Baseline | null | undefined): Finding[];
export function buildSecurity(input?: { trivy?: unknown; opengrep?: unknown; baseline?: Baseline | null; skipped?: string }): {
  security: { status: 'pass' | 'fail' | 'skipped'; new_high: number; skipped_reason?: string };
  high: number; newFindings: Finding[]; baselined: number;
};
