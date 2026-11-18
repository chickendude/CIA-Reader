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
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Flag' })).not.toBeNull();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Off' })).not.toBeNull();
  });

  it('marks "Off" active when the overlay is disabled', () => {
    renderPopover({ isAdmin: true, flagUndefined: false });
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Off' }).checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Flag' }).checked,
    ).toBe(false);
  });

  it('marks "Flag" active when the overlay is enabled', () => {
    renderPopover({ isAdmin: true, flagUndefined: true });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Flag' }).checked).toBe(true);
  });

  it('fires onFlagUndefinedChange(true) when "Flag" is clicked', async () => {
    const onFlagUndefinedChange = vi.fn();
    renderPopover({ isAdmin: true, flagUndefined: false, onFlagUndefinedChange });
    await fireEvent.click(screen.getByRole<HTMLInputElement>('radio', { name: 'Flag' }));
    expect(onFlagUndefinedChange).toHaveBeenCalledWith(true);
  });

  it('fires onFlagUndefinedChange(false) when "Off" is clicked', async () => {
    const onFlagUndefinedChange = vi.fn();
    renderPopover({ isAdmin: true, flagUndefined: true, onFlagUndefinedChange });
    await fireEvent.click(screen.getByRole<HTMLInputElement>('radio', { name: 'Off' }));
    expect(onFlagUndefinedChange).toHaveBeenCalledWith(false);
  });
});
