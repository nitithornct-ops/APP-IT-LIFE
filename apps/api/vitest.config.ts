import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 24,
        statements: 21,
        functions: 25,
        branches: 12,
        'src/middleware/**': { lines: 69, statements: 68, functions: 83, branches: 50 },
        'src/services/**': { lines: 63, statements: 60, functions: 67, branches: 55 },
        'src/utils/**': { lines: 92, statements: 89, functions: 95, branches: 82 },
        'src/validators/**': { lines: 91, statements: 89, functions: 65, branches: 68 },
      },
    },
  },
});
