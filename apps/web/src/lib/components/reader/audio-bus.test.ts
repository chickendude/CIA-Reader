// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetAudioBus,
  getAudioController,
  getAudioState,
  setAudioController,
  setAudioState,
  subscribeAudio,
} from './audio-bus.js';

beforeEach(() => _resetAudioBus());

describe('audio-bus', () => {
  it('seeds subscribers with the current state synchronously', () => {
    setAudioState({ currentTimeMs: 1000 });
    const fn = vi.fn();
    subscribeAudio(fn);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ currentTimeMs: 1000 }),
    );
  });

  it('forwards subsequent state changes to subscribers', () => {
    const fn = vi.fn();
    subscribeAudio(fn);
    setAudioState({ isPlaying: true });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1]?.[0]).toMatchObject({ isPlaying: true });
  });

  it('lets the unsubscribe stop further notifications', () => {
    const fn = vi.fn();
    const off = subscribeAudio(fn);
    off();
    setAudioState({ currentTimeMs: 5 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exposes the latest state without subscribing', () => {
    setAudioState({ currentTimeMs: 42, audioFileId: 'a' });
    expect(getAudioState()).toMatchObject({
      currentTimeMs: 42,
      audioFileId: 'a',
    });
  });

  it('stores a single controller handle', () => {
    expect(getAudioController()).toBeNull();
    const ctrl = { seekMs: vi.fn(), play: vi.fn(), pause: vi.fn() };
    setAudioController(ctrl);
    expect(getAudioController()).toBe(ctrl);
    setAudioController(null);
    expect(getAudioController()).toBeNull();
  });
});
