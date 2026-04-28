import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

import Sheet from './Sheet.svelte';
import { __resetScrollLockForTests } from './scroll-lock.js';

beforeEach(() => {
  __resetScrollLockForTests();
  // jsdom doesn't implement scrollTo; the lock-scroll release branch
  // would otherwise pollute stderr.
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  // Tear down the previous test's mount so .sheet-back queries don't
  // pick up a leftover element on the next render.
  cleanup();
  vi.unstubAllGlobals();
  __resetScrollLockForTests();
});

describe('Sheet — dimmed prop (T-5.17)', () => {
  it('paints a dimmed scrim by default', () => {
    render(Sheet, { open: true, onClose: () => {} });
    const back = document.body.querySelector('.sheet-back');
    expect(back).not.toBeNull();
    expect(back!.classList.contains('dimmed')).toBe(true);
  });

  it('omits the .dimmed class when dimmed={false} so the reader text stays readable', () => {
    render(Sheet, {
      open: true,
      onClose: () => {},
      dimmed: false,
    });
    const back = document.body.querySelector('.sheet-back');
    expect(back).not.toBeNull();
    expect(back!.classList.contains('dimmed')).toBe(false);
  });

  // The .dimmed class is what gates pointer-events in CSS:
  //   .sheet-back            { pointer-events: none; }
  //   .sheet-back.dimmed     { pointer-events: auto; }
  // jsdom doesn't compute Svelte-scoped CSS rules so we assert the
  // class state instead and let manual / preview verification cover
  // the pixel-level behavior.
  it('keeps the dimmed backdrop interactive so click-outside-to-close works in modal mode', async () => {
    let closed = 0;
    render(Sheet, {
      open: true,
      dimmed: true,
      onClose: () => {
        closed += 1;
      },
    });
    const back = document.body.querySelector('.sheet-back') as HTMLElement;
    expect(back.classList.contains('dimmed')).toBe(true);
    await fireEvent.click(back);
    expect(closed).toBe(1);
  });
});

describe('Sheet — portal (T-5.28)', () => {
  // The reader's page-mode content uses `transform` for the page-flip
  // slide, which creates a containing block for fixed-positioned
  // descendants. Without portaling, the sheet's backdrop would inherit
  // that translated, max-width-capped column instead of spanning the
  // viewport. Lock that the backdrop ends up directly under <body>.
  it('portals the backdrop to <body> so it escapes ancestor containing blocks', () => {
    const { container } = render(Sheet, { open: true, onClose: () => {} });
    expect(container.querySelector('.sheet-back')).toBeNull();
    const back = document.body.querySelector('.sheet-back');
    expect(back).not.toBeNull();
    expect(back!.parentElement).toBe(document.body);
  });

  it('removes the portaled backdrop when the sheet unmounts', () => {
    const { unmount } = render(Sheet, { open: true, onClose: () => {} });
    expect(document.body.querySelector('.sheet-back')).not.toBeNull();
    unmount();
    expect(document.body.querySelector('.sheet-back')).toBeNull();
  });
});
