import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        HTMLElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        FocusEvent: 'readonly',
        // Drag-and-drop + file upload globals (T-4.1).
        DragEvent: 'readonly',
        File: 'readonly',
        FileList: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        // Reader keyboard handlers (T-5.7).
        EventTarget: 'readonly',
      },
    },
  },
  {
    // One-shot Node helper scripts under `scripts/`. They run directly
    // under the local Node interpreter, so the standard Node globals
    // (process, console, …) are available. Keeping them out of the
    // svelte/browser-globals block above avoids polluting the route
    // code's typecheck with Node names.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      // Scripts often pull in helpers they end up not using as the
      // shape evolves; not worth blocking commits over.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: ['build/', '.svelte-kit/', 'drizzle/', 'node_modules/'],
  },
];
