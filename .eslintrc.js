'use strict';

/**
 * Repo-wide ESLint config.
 *
 * Extends @react-native (the same preset RN itself uses) so the rules we
 * apply to *.linux.js files match what RN core enforces upstream — keeps the
 * fork small and lint-clean.
 *
 * We layer on `prettier` so eslint and prettier don't fight over formatting.
 * Run `pnpm lint` from the repo root.
 */
module.exports = {
  root: true,
  extends: ['@react-native', 'prettier'],
  ignorePatterns: [
    'node_modules/',
    '**/node_modules/',
    '**/lib/',
    '**/dist/',
    '**/build/',
    'vnext/build/',
    'vnext/codegen/',
    'packages/**/templates/**',
  ],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    {
      files: ['**/__tests__/**/*.{js,ts,tsx}'],
      env: {jest: true},
    },
    {
      files: ['scripts/**/*.js'],
      env: {node: true},
    },
  ],
};
