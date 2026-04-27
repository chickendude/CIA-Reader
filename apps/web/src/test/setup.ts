/**
 * Vitest setup file. Runs once before each test file.
 *
 * We deliberately keep this empty at M0 — the minimum SvelteKit + jsdom env is
 * enough for unit tests of pure-TS modules (auth helpers, NLP client, language
 * registry). Add global mocks here only when a shared stub is genuinely needed
 * across many tests.
 */

export {};
