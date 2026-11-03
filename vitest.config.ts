import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'hosts/claude-code/test/**/*.test.mjs'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/lib/**/*.mjs', 'hosts/claude-code/hooks/lib/**/*.mjs'],
      exclude: ['src/**/*.d.ts', 'src/domain/types.ts', 'src/cli/index.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Regression guard: only enforced with --coverage (npm run test:coverage).
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 94 },
    },
  },
});
