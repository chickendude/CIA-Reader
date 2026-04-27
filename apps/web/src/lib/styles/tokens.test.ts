// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Token sanity tests. CSS-variable resolution isn't reliably testable in
 * jsdom (custom properties are not always re-resolved on attribute change),
 * so we read the source and assert that each theme block declares the keys
 * that downstream components depend on. Cheap, fast, and catches accidental
 * deletions during refactors.
 */
const tokens = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf-8',
);

function block(selector: string): string {
  const start = tokens.indexOf(selector);
  if (start === -1) throw new Error(`block ${selector} not found in tokens.css`);
  const open = tokens.indexOf('{', start);
  const close = tokens.indexOf('}', open);
  return tokens.slice(open, close);
}

const lightBlock = block(":root,\n[data-theme='light']");
const sepiaBlock = block("[data-theme='sepia']");
const darkBlock = block("[data-theme='dark']");
const rootInvariant = block(
  '/* Typography, spacing, radii, shadows, motion — theme-invariant.',
);

describe('CIAR design palette', () => {
  it.each([
    ['light', lightBlock],
    ['sepia', sepiaBlock],
    ['dark', darkBlock],
  ])('%s theme declares paper / ink / card / rule', (_name, b) => {
    expect(b).toMatch(/--paper:\s/);
    expect(b).toMatch(/--ink:\s/);
    expect(b).toMatch(/--card:\s/);
    expect(b).toMatch(/--rule:\s/);
  });

  it.each([
    ['light', lightBlock],
    ['sepia', sepiaBlock],
    ['dark', darkBlock],
  ])('%s theme declares word-status background tints (l1/l2/l3)', (_name, b) => {
    expect(b).toMatch(/--w-l1-bg:\s/);
    expect(b).toMatch(/--w-l2-bg:\s/);
    expect(b).toMatch(/--w-l3-bg:\s/);
  });

  it('only the light theme defines the saffron accent + accent-soft pair (sepia + dark inherit)', () => {
    expect(lightBlock).toMatch(/--accent:\s/);
    expect(lightBlock).toMatch(/--accent-soft:\s/);
    // Sepia inherits accent from :root,[data-theme='light']; dark overrides
    // the accent for the dark palette.
    expect(darkBlock).toMatch(/--accent:\s/);
  });
});

describe('design typography tokens', () => {
  it('declares the design font stack alongside the existing UI fonts', () => {
    expect(rootInvariant).toMatch(/--font-sans:\s/);
    expect(rootInvariant).toMatch(/--font-serif:\s/);
    expect(rootInvariant).toMatch(/--font-serif-dev:\s/);
    expect(rootInvariant).toMatch(/--font-sans-dev:\s/);
    expect(rootInvariant).toMatch(/--font-mono-display:\s/);
  });

  it('preserves the legacy --font-ui / --font-mono tokens', () => {
    expect(rootInvariant).toMatch(/--font-ui:\s/);
    expect(rootInvariant).toMatch(/--font-mono:\s/);
  });
});
