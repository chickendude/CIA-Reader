import { defineConfig } from 'vitest/config';

/**
 * Most extension logic is pure (VTT parsing, frequency counting, cache key
 * shaping, the auth-client refresh state machine) and unit-tested against
 * in-memory fakes, so the default `node` environment is enough. Anything that
 * truly needs a DOM opts in per-file with `// @vitest-environment jsdom`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        // Thin platform bindings (IndexedDB / messaging / DOM glue) are
        // covered via integration / manual loading, not unit tests — their
        // pure logic is extracted into tested helpers.
        'src/shared/browser.ts',
      ],
    },
  },
});
