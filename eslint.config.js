import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Node builtins that `packages/core` is forbidden from importing.
 * `node:crypto` is the single documented exception: it is deterministic and performs
 * no I/O, which lets `computeHash` live in core alongside the chain verifier it serves.
 */
const BARE_NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'cluster', 'dgram', 'dns', 'fs', 'http', 'http2',
  'https', 'net', 'os', 'path', 'perf_hooks', 'process', 'readline', 'stream', 'tls',
  'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      // Everything here runs under `node --experimental-strip-types`, which erases types
      // rather than compiling them and so cannot desugar a parameter property into a field
      // assignment. Typecheck and tests both pass on this syntax; only the CLI fails, at
      // runtime, which is the worst place to find out. Caught at lint instead.
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
    },
  },
  {
    // The core-purity rule. `packages/core` holds every constraint the architecture
    // enforces; it stays pure so those constraints are testable without a database,
    // a network, or a model. See also packages/core/test/core-purity.test.ts, which
    // enforces the same invariant independently of lint being run.
    // Scoped to src only: core's own tests are allowed to read the filesystem, which is how
    // core-purity.test.ts checks this same invariant independently of lint being run.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...BARE_NODE_BUILTINS.map((name) => ({
              name,
              message: 'packages/core must not perform I/O. Only node:crypto is permitted.',
            })),
            {
              name: 'pg',
              message: 'packages/core must not depend on the database. Move this to packages/store.',
            },
          ],
          patterns: [
            {
              group: ['node:*', '!node:crypto'],
              message: 'packages/core must not perform I/O. Only node:crypto is permitted.',
            },
            {
              group: ['@mae/store', '@mae/store/*', '@mae/fields', '@mae/fields/*'],
              message:
                'packages/core must not depend on store or fields. Dependencies point inward.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
