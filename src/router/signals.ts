import picomatch from 'picomatch';
import type { PathRule, Policy, Size, Workspace } from '../domain/types.js';

export const DEFAULT_RISK_PATHS: string[] = [
  '**/payments/**', '**/billing/**', '**/auth/**', '**/*crypto*', '**/migrations/**',
  'infra/**', '**/*.tf', '.github/workflows/**',
];

const matchOptions = { dot: true };

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function topLevelDir(path: string): string {
  const cleaned = normalizePath(path);
  return cleaned.split('/')[0] ?? cleaned;
}

export function sizeOf(ws: Workspace): Size {
  const files = ws.estimated_files ?? null;
  const newSubsystem = ws.new_subsystem === true;
  if (files === null && !newSubsystem) return 'unknown';
  if ((files !== null && files >= 20) || (ws.repositories ?? 0) >= 2 || newSubsystem) return 'large';
  const paths = ws.paths_touched ?? [];
  const oneDir = paths.length === 0 || new Set(paths.map(topLevelDir)).size === 1;
  if (files !== null && files <= 3 && oneDir) return 'small';
  return 'medium';
}

export function greenfieldOf(ws: Workspace): boolean | null {
  if (typeof ws.is_greenfield === 'boolean') return ws.is_greenfield;
  if (typeof ws.has_spec_library === 'boolean') return !ws.has_spec_library;
  return null;
}

export function matchRiskPaths(paths: string[], extra: string[]): string[] {
  const isRisk = picomatch([...DEFAULT_RISK_PATHS, ...extra], matchOptions);
  return paths.filter((p) => isRisk(normalizePath(p)));
}

export function matchPolicyPathRule(policy: Policy | null, paths: string[]): PathRule | null {
  if (!policy) return null;
  for (const rule of policy.path_rules) {
    const m = picomatch(rule.glob, matchOptions);
    if (paths.some((p) => m(normalizePath(p)))) return rule;
  }
  return null;
}
