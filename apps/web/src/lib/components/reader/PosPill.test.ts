import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

import PosPill from './PosPill.svelte';

afterEach(() => {
  cleanup();
});

describe('PosPill', () => {
  it('renders the abbreviated form for a known UD tag', () => {
    const { container } = render(PosPill, { pos: 'NOUN' });
    const pill = container.querySelector('[data-testid="pos-pill"]');
    expect(pill).not.toBeNull();
    expect(pill!.querySelector('.pos-abbr')?.textContent).toBe('n');
  });

  it('renders the full name inside the tooltip popover', () => {
    const { container } = render(PosPill, { pos: 'PROPN' });
    const pop = container.querySelector('.pos-pop');
    expect(pop?.textContent?.trim()).toBe('proper noun');
  });

  it('exposes the full name via aria-label so screen readers read it instead of the abbr', () => {
    const { container } = render(PosPill, { pos: 'ADV' });
    const pill = container.querySelector<HTMLElement>(
      '[data-testid="pos-pill"]',
    );
    expect(pill?.getAttribute('aria-label')).toBe('adverb');
  });

  it('falls back to a lowercased copy for unknown tags', () => {
    const { container } = render(PosPill, { pos: 'WEIRD' });
    const pill = container.querySelector('[data-testid="pos-pill"]');
    expect(pill!.querySelector('.pos-abbr')?.textContent).toBe('weird');
    expect(pill!.querySelector('.pos-pop')?.textContent?.trim()).toBe('weird');
  });

  it('forwards the optional class hook so callers can position the pill', () => {
    const { container } = render(PosPill, { pos: 'NOUN', class: 'extra-hook' });
    const pill = container.querySelector('[data-testid="pos-pill"]');
    expect(pill?.classList.contains('extra-hook')).toBe(true);
    expect(pill?.classList.contains('pos-pill')).toBe(true);
  });
});
