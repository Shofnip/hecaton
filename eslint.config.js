import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'coverage/**'],
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
    // Hook scripts are plain Node ESM, run by the Claude Code harness rather
    // than by the app, so they get Node globals and none of the TS rules.
    files: ['.claude/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
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
