import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    // spike/ is disposable probe code outside the packages; its findings are
    // recorded in the ADRs and it never ships or enters git.
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'coverage/**', 'spike/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Hook scripts are plain Node ESM, run by an agent harness rather than by
    // the app, so they get Node globals and none of the TS rules. Both harness
    // directories are listed: the same hook is mirrored under `.codex/`, and
    // scoping this to one of them made lint fail on a file identical to one it
    // already accepted.
    // Build scripts under apps/*/scripts are the same shape: plain ESM run by
    // npm, never bundled into anything the user runs.
    files: ['.claude/**/*.mjs', '.codex/**/*.mjs', 'apps/*/scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // The preload has to be CommonJS: it runs sandboxed, and Electron cannot
    // load an ESM preload - it fails with "Cannot use import statement outside
    // a module", leaving the bridge undefined and the panel blank with nothing
    // on stdout. `verbatimModuleSyntax` then requires the .cts file to write
    // the require it means. This is the one place in the app where that is
    // true, so the exception is scoped to it rather than disabled inline.
    files: ['apps/*/src/preload/**/*.cts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // The pure core must stay free of I/O. This is the project's central
    // architectural boundary, so it is enforced rather than merely documented:
    // if a decision needs the filesystem, a process or the network, the decision
    // belongs here and the I/O belongs in an adapter.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'fs',
                'node:fs',
                'node:fs/promises',
                'path',
                'node:path',
                'os',
                'node:os',
                'child_process',
                'node:child_process',
                'http',
                'node:http',
                'https',
                'node:https',
                'net',
                'node:net',
                'electron',
              ],
              message:
                'packages/core must stay pure. Move the I/O to an adapter and keep the decision here.',
            },
          ],
        },
      ],
    },
  },
)
