import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

import ReaderSettings from './ReaderSettings.svelte';
import { DEFAULT_READER_SETTINGS } from './reader-settings.js';

function renderPopover(props: Record<string, unknown> = {}) {
  return render(ReaderSettings, {
    open: true,
    onClose: () => {},
    language: 'hi',
    settings: DEFAULT_READER_SETTINGS,
    onChange: () => {},
    // Skip the per-language PATCH network path in these tests.
    canPersist: false,
    ...props,
  });
}

afterEach(() => cleanup());

describe('ReaderSettings — admin undefined-words overlay (#435)', () => {
  it('hides the admin section for non-admins', () => {
    renderPopover({ isAdmin: false });
    expect(screen.queryByTestId('rs-admin')).toBeNull();
  });

  it('shows the admin section for admins', () => {
    renderPopover({ isAdmin: true });
    expect(screen.getByTestId('rs-admin')).not.toBeNull();
    expect(screen.getByTestId('rs-flag-undefined-on')).not.toBeNull();
    expect(screen.getByTestId('rs-flag-undefined-off')).not.toBeNull();
  });

  it('marks "Off" active when the overlay is disabled', () => {
    renderPopover({ isAdmin: true, flagUndefined: false });
    expect(
      screen.getByTestId('rs-flag-undefined-off').getAttribute('data-active'),
    ).toBe('1');
    expect(
      screen.getByTestId('rs-flag-undefined-on').getAttribute('data-active'),
    ).toBe('0');
  });

  it('marks "Flag" active when the overlay is enabled', () => {
    renderPopover({ isAdmin: true, flagUndefined: true });
    expect(
      screen.getByTestId('rs-flag-undefined-on').getAttribute('data-active'),
    ).toBe('1');
    expect(
      screen.getByTestId('rs-flag-undefined-on').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('fires onFlagUndefinedChange(true) when "Flag" is clicked', async () => {
    const onFlagUndefinedChange = vi.fn();
    renderPopover({ isAdmin: true, flagUndefined: false, onFlagUndefinedChange });
    await fireEvent.click(screen.getByTestId('rs-flag-undefined-on'));
    expect(onFlagUndefinedChange).toHaveBeenCalledWith(true);
  });

  it('fires onFlagUndefinedChange(false) when "Off" is clicked', async () => {
    const onFlagUndefinedChange = vi.fn();
    renderPopover({ isAdmin: true, flagUndefined: true, onFlagUndefinedChange });
    await fireEvent.click(screen.getByTestId('rs-flag-undefined-off'));
    expect(onFlagUndefinedChange).toHaveBeenCalledWith(false);
  });
});
