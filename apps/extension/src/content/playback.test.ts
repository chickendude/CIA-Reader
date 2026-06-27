import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaybackController } from './playback';
import type { VideoController } from './video';

function fakeVideo() {
  let t = 0;
  let paused = false;
  return {
    currentTime: () => t,
    isPaused: () => paused,
    seek: vi.fn((s: number) => {
      t = s;
      paused = false;
    }),
    pause: vi.fn(() => {
      paused = true;
    }),
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

  it('pauses on each line change and reveals the line that just ended', () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const revealed: string[] = [];
    const pb = new PlaybackController(v as unknown as VideoController);
    pb.onLinePause = (text) => revealed.push(text);
    pb.setCues(cues);
    expect(pb.toggleAutoPause()).toBe(true);

    pb.onText('one'); // first line appears — nothing has ended yet
    expect(v.pause).not.toHaveBeenCalled();

    pb.onText('two'); // 'one' just ended → pause + reveal it
    expect(v.pause).toHaveBeenCalledTimes(1);
    expect(revealed).toEqual(['one']);

    // Adjacent cue with no gap still gets its own pause once the user resumes.
    pb.onText('two'); // (resumed; same text re-asserted — no double pause)
    expect(v.pause).toHaveBeenCalledTimes(1);
  });

  it('returns the surrounding subtitle lines for card context', () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const pb = new PlaybackController(v as unknown as VideoController);
    pb.setCues(cues);

    expect(pb.neighborsOf('two')).toEqual({ before: 'one', after: 'three' });
    expect(pb.neighborsOf('one')).toEqual({ before: null, after: 'two' });
    expect(pb.neighborsOf('three')).toEqual({ before: 'two', after: null });
  });

  it('gives the mid-cue video time for a line (for card screenshots)', () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const pb = new PlaybackController(v as unknown as VideoController);
    pb.setCues(cues);
    v.setTime(13);
    pb.onText('two'); // offset 10000ms

    // cue "two" 3000–4000 → mid 3500ms + 10000 offset = 13.5s
    expect(pb.timeForLine('two')).toBeCloseTo(13.5, 5);
    expect(pb.timeForLine('one')).toBeCloseTo(11.5, 5);
    expect(pb.timeForLine('nope')).toBeCloseTo(13.5, 5); // unknown → active cue
  });

  it('does not pause on the line change a seek causes', () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const pb = new PlaybackController(v as unknown as VideoController);
    pb.setCues(cues);

    v.setTime(13);
    pb.onText('two'); // calibrate (offset 10000ms), prevLine = 'two'
    expect(pb.toggleListening()).toBe(true);

    pb.next(); // seek to 'three' — its appearance must not trigger a pause
    pb.onText('three');
    expect(v.pause).not.toHaveBeenCalled();

    pb.onText('one'); // a real change — 'three' ended → pause
    expect(v.pause).toHaveBeenCalledTimes(1);
  });
});
