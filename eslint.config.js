// ESLint flat config (ESLint 9+).
// `npm run lint` runs `eslint src` — only first-party TypeScript is linted.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'vscode-extension/dist/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Project convention (CLAUDE.md): no `any` without an eslint-disable
      // comment explaining why. Surface as an error so new ones need a
      // justified disable, matching the documented convention.
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow intentionally-unused parameters/vars with a leading underscore
      // (common for interface-conformant callbacks).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Node build/utility scripts are plain JS — lint them without TS rules.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  }
);
