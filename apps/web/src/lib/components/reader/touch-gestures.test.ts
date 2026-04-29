// @vitest-environment node
/**
 * Tests for reader touch gestures (T-5.1c).
 */
import { describe, expect, it, vi } from 'vitest';

import { LongPressDetector, classifySwipe } from './touch-gestures.js';

describe('classifySwipe', () => {
  it('reports left-swipe (-1) when end.x < start.x by > threshold', () => {
    const r = classifySwipe({ x: 200, y: 100 }, { x: 100, y: 110 });
    expect(r.direction).toBe(-1);
    expect(r.dx).toBe(-100);
  });

  it('reports right-swipe (+1) when end.x > start.x by > threshold', () => {
    const r = classifySwipe({ x: 50, y: 100 }, { x: 200, y: 110 });
    expect(r.direction).toBe(1);
  });

  it('reports no swipe when horizontal travel is below the threshold', () => {
    const r = classifySwipe({ x: 100, y: 100 }, { x: 130, y: 105 });
    expect(r.direction).toBe(0);
  });

  it('reports no swipe when vertical movement dominates (= the user was scrolling)', () => {
    const r = classifySwipe({ x: 100, y: 100 }, { x: 80, y: 400 });
    expect(r.direction).toBe(0);
  });

  it('honors a custom threshold', () => {
    expect(classifySwipe({ x: 100, y: 0 }, { x: 130, y: 0 }, 20).direction).toBe(1);
    expect(classifySwipe({ x: 100, y: 0 }, { x: 130, y: 0 }, 50).direction).toBe(0);
  });
});

describe('LongPressDetector', () => {
  function makeFakeTimer() {
    const tasks = new Map<number, () => void>();
    let next = 1;
    const setTimer = (cb: () => void) => {
      const h = next++;
      tasks.set(h, cb);
      return h;
    };
    const clearTimer = (h: number) => {
      tasks.delete(h);
    };
    const fire = (h: number) => {
      const cb = tasks.get(h);
      if (cb) {
        tasks.delete(h);
        cb();
      }
    };
    return { setTimer, clearTimer, fire, tasks };
  }

  it('fires the callback after the hold elapses with the start point', () => {
    const onLongPress = vi.fn();
    const t = makeFakeTimer();
    const d = new LongPressDetector(onLongPress, {
      holdMs: 500,
      setTimeout: t.setTimer,
      clearTimeout: t.clearTimer,
    });
    d.begin({ x: 100, y: 200 });
    expect(d.armed).toBe(true);
    expect(onLongPress).not.toHaveBeenCalled();
    // Walk the timer forward.
    t.fire(1);
    expect(onLongPress).toHaveBeenCalledWith({ x: 100, y: 200 });
  });

  it('cancels on movement past the slop radius', () => {
    const onLongPress = vi.fn();
    const t = makeFakeTimer();
    const d = new LongPressDetector(onLongPress, {
      slopPx: 8,
      setTimeout: t.setTimer,
      clearTimeout: t.clearTimer,
    });
    d.begin({ x: 100, y: 200 });
    expect(d.move({ x: 105, y: 202 })).toBe(false);
    expect(d.armed).toBe(true);
    expect(d.move({ x: 200, y: 200 })).toBe(true);
    expect(d.armed).toBe(false);
    // Even if the timer were to fire, the start point is gone.
    t.fire(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels on release', () => {
    const onLongPress = vi.fn();
    const t = makeFakeTimer();
    const d = new LongPressDetector(onLongPress, {
      setTimeout: t.setTimer,
      clearTimeout: t.clearTimer,
    });
    d.begin({ x: 0, y: 0 });
    d.release();
    t.fire(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('allows back-to-back presses (begin replaces a stale timer)', () => {
    const onLongPress = vi.fn();
    const t = makeFakeTimer();
    const d = new LongPressDetector(onLongPress, {
      setTimeout: t.setTimer,
      clearTimeout: t.clearTimer,
    });
    d.begin({ x: 0, y: 0 });
    d.begin({ x: 50, y: 50 });
    // Original handle 1 was cleared; new handle 2 is the live one.
    t.fire(2);
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(onLongPress).toHaveBeenCalledWith({ x: 50, y: 50 });
  });
});
