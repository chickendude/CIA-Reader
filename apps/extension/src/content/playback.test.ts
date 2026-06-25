import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaybackController } from './playback';
import type { VideoController } from './video';

function fakeVideo() {
  let t = 0;
  return {
    currentTime: () => t,
    seek: vi.fn((s: number) => {
      t = s;
    }),
    pause: vi.fn(),
    setTime: (s: number) => {
      t = s;
    },
  };
}

const cues = [
  { startMs: 1000, endMs: 2000, text: 'one' },
  { startMs: 3000, endMs: 4000, text: 'two' },
  { startMs: 5000, endMs: 6000, text: 'three' },
];

afterEach(() => vi.useRealTimers());

describe('PlaybackController', () => {
  it('calibrates the offset from the on-screen line and seeks prev/next/repeat', () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const pb = new PlaybackController(v as unknown as VideoController);
    pb.setCues(cues);

    // "two" (cue start 3000ms) shows while the video is at 13.0s → offset 10000ms.
    v.setTime(13);
    pb.onText('two');
    const lastSeek = () => v.seek.mock.calls.at(-1)![0];

    pb.repeat();
    expect(lastSeek()).toBeCloseTo(13.02, 5); // (3000+10000)/1000 + .02
    pb.next();
    expect(lastSeek()).toBeCloseTo(15.02, 5); // cue "three"
    pb.prev();
    expect(lastSeek()).toBeCloseTo(13.02, 5); // back to "two"
    pb.prev();
    expect(lastSeek()).toBeCloseTo(11.02, 5); // "one"
    pb.prev(); // already at first — no further seek
    expect(v.seek).toHaveBeenCalledTimes(4);
  });

  it('auto-pauses once at the end of the current line when enabled', () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const pb = new PlaybackController(v as unknown as VideoController);
    pb.setCues(cues);

    v.setTime(1.5);
    pb.onText('one'); // offset = 1500 - 1000 = 500ms → line ends at 2.5s video time
    expect(pb.toggleAutoPause()).toBe(true);

    v.setTime(2.4);
    vi.advanceTimersByTime(120);
    expect(v.pause).not.toHaveBeenCalled();

    v.setTime(2.6);
    vi.advanceTimersByTime(120);
    expect(v.pause).toHaveBeenCalledTimes(1);

    v.setTime(2.7);
    vi.advanceTimersByTime(120);
    expect(v.pause).toHaveBeenCalledTimes(1); // not again for the same line
  });
});
