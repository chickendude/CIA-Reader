import js from '@eslint/js';
import ts from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // TypeScript (+ the DOM / webextension lib types) already resolves
      // undefined identifiers, so we don't enumerate browser/worker globals
      // for ESLint. This is the typescript-eslint-recommended setup.
      'no-undef': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'web-ext-artifacts/'],
  },
];
