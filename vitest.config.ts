import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  '@mae/core': r('./packages/core/src/index.ts'),
  '@mae/store': r('./packages/store/src/index.ts'),
  '@mae/fields': r('./packages/fields/src/index.ts'),
  '@mae/runtime': r('./packages/runtime/src/index.ts'),
  '@mae/ui': r('./packages/ui/src/index.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // The store and fields suites share one module-level connection pool and one database.
    // Run files serially: in parallel, one file's `closePool` in afterAll tears the pool out
    // from under another file still using it, which surfaces as unrelated suites appearing
    // to skip. Core is pure and fast enough that serializing it costs nothing.
    fileParallelism: false,
    projects: [
      // `core` is pure: no database, no network, no API keys. It always runs.
      {
        resolve: { alias },
        test: { name: 'core', include: ['packages/core/test/**/*.test.ts'] },
      },
      // These need a database. They skip cleanly when DATABASE_URL is unset (there is no
      // Docker daemon in every environment) and run for real in CI against pgvector.
      {
        resolve: { alias },
        test: {
          name: 'store',
          include: ['packages/store/test/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'fields',
          include: ['packages/fields/test/**/*.test.ts'],
        },
      },
      // The transport suite is pure too: cassettes replay from disk, and nothing in it
      // opens a socket or reads a credential.
      {
        resolve: { alias },
        test: { name: 'runtime', include: ['packages/runtime/test/**/*.test.ts'] },
      },
      {
        resolve: { alias },
        test: { name: 'cli', include: ['packages/cli/test/**/*.test.ts'] },
      },
      // Renderers are pure functions from domain objects to HTML, so they test like the
      // CLI's renderers do: no browser, no database, no server.
      {
        resolve: { alias },
        test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'] },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['packages/core/src/**/index.ts', 'packages/core/src/types/**'],
      // The correctness-bearing modules. CI fails if these regress.
      thresholds: {
        'packages/core/src/charter/**': {
          branches: 90,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        'packages/core/src/composition/**': {
          branches: 90,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/core/src/metrics/**': {
          branches: 90,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
