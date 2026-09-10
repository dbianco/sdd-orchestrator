import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RISK_PATHS, sizeOf, greenfieldOf, matchRiskPaths, matchPolicyPathRule, topLevelDir,
} from '../../../src/router/signals.js';

describe('sizeOf', () => {
  it('is small for <=3 files in one top-level dir', () => {
    expect(sizeOf({ estimated_files: 3, paths_touched: ['src/a.ts', 'src/b/c.ts'] })).toBe('small');
  });
  it('is small for <=3 files with no paths given', () => {
    expect(sizeOf({ estimated_files: 2 })).toBe('small');
  });
  it('is medium for <=3 files spread over two top-level dirs', () => {
    expect(sizeOf({ estimated_files: 2, paths_touched: ['src/a.ts', 'docs/b.md'] })).toBe('medium');
  });
  it('is large for >=20 files, >=2 repositories or a new subsystem', () => {
    expect(sizeOf({ estimated_files: 20 })).toBe('large');
    expect(sizeOf({ estimated_files: 5, repositories: 2 })).toBe('large');
    expect(sizeOf({ estimated_files: 5, new_subsystem: true })).toBe('large');
    expect(sizeOf({ estimated_files: null, new_subsystem: true })).toBe('large');
  });
  it('is medium otherwise', () => {
    expect(sizeOf({ estimated_files: 8 })).toBe('medium');
  });
  it('is unknown when estimated_files is null and new_subsystem is not true', () => {
    expect(sizeOf({})).toBe('unknown');
    expect(sizeOf({ repositories: 3 })).toBe('unknown');
  });
});

describe('greenfieldOf', () => {
  it('uses is_greenfield first', () => {
    expect(greenfieldOf({ is_greenfield: true, has_spec_library: true })).toBe(true);
  });
  it('falls back to not has_spec_library', () => {
    expect(greenfieldOf({ has_spec_library: true })).toBe(false);
    expect(greenfieldOf({ has_spec_library: false })).toBe(true);
  });
  it('is null when both unknown', () => {
    expect(greenfieldOf({})).toBeNull();
  });
});

describe('matchRiskPaths', () => {
  it('ships the default list', () => {
    expect(DEFAULT_RISK_PATHS).toEqual([
      '**/payments/**', '**/billing/**', '**/auth/**', '**/*crypto*', '**/migrations/**',
      'infra/**', '**/*.tf', '.github/workflows/**',
    ]);
  });
  it('matches defaults and policy extras', () => {
    expect(matchRiskPaths(['src/payments/charge.ts', 'src/orders/x.ts'], [])).toEqual(['src/payments/charge.ts']);
    expect(matchRiskPaths(['lib/crypto.ts'], [])).toEqual(['lib/crypto.ts']);
    expect(matchRiskPaths(['infra/main.tf'], [])).toEqual(['infra/main.tf']);
    expect(matchRiskPaths(['.github/workflows/ci.yml'], [])).toEqual(['.github/workflows/ci.yml']);
    expect(matchRiskPaths(['src/webhooks/stripe.ts'], ['**/webhooks/**'])).toEqual(['src/webhooks/stripe.ts']);
    expect(matchRiskPaths(['src/orders/x.ts'], [])).toEqual([]);
  });
});

describe('matchPolicyPathRule', () => {
  const policy = { framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }], risk_paths: [] };
  it('returns the first matching rule', () => {
    expect(matchPolicyPathRule(policy, ['src/payments/x.ts'])).toEqual({ glob: '**/payments/**', framework: 'bmad' });
  });
  it('returns null with no match or no policy', () => {
    expect(matchPolicyPathRule(policy, ['src/orders/x.ts'])).toBeNull();
    expect(matchPolicyPathRule(null, ['src/payments/x.ts'])).toBeNull();
  });
});

describe('topLevelDir', () => {
  it('returns the first segment', () => {
    expect(topLevelDir('src/a/b.ts')).toBe('src');
    expect(topLevelDir('README.md')).toBe('README.md');
    expect(topLevelDir('./src/x')).toBe('src');
  });
});
