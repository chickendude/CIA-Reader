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
    files: ['src/**/*.{ts,js,svelte}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '$app/stores', message: 'Read reactive navigation state from $app/state.' }],
      }],
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        svelteFeatures: { experimentalGenerics: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        Node: 'readonly',
        CustomEvent: 'readonly',
        structuredClone: 'readonly',
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
        DragEvent: 'readonly',
        File: 'readonly',
        FileList: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        EventTarget: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        TouchEvent: 'readonly',
        PointerEvent: 'readonly',
        CompositionEvent: 'readonly',
        ClipboardEvent: 'readonly',
        HTMLAudioElement: 'readonly',
        CSS: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        queueMicrotask: 'readonly',
        confirm: 'readonly',
        SubmitEvent: 'readonly',
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
