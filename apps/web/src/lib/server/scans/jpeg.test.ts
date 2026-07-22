// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { jpegDimensions } from './jpeg.js';

/** Build a minimal JPEG byte stream: SOI, optional filler segments, SOF0. */
function fakeJpeg(width: number, height: number, opts?: { app0?: boolean; restart?: boolean }): Uint8Array {
  const bytes: number[] = [0xff, 0xd8]; // SOI
  if (opts?.app0) {
    // APP0 segment with a 16-byte payload (length includes the 2 length bytes).
    bytes.push(0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0x4a));
  }
  if (opts?.restart) bytes.push(0xff, 0xd0); // standalone RST marker
  // SOF0: length 17, precision 8, height, width, 3 components.
  bytes.push(
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  );
  return new Uint8Array(bytes);
}

describe('jpegDimensions', () => {
  it('reads dimensions from a plain SOF0', () => {
    expect(jpegDimensions(fakeJpeg(1654, 2339))).toEqual({ width: 1654, height: 2339 });
  });

  it('walks past APP0 and standalone markers first', () => {
    expect(jpegDimensions(fakeJpeg(200, 100, { app0: true, restart: true }))).toEqual({
      width: 200,
      height: 100,
    });
  });

  it('handles large dimensions (16-bit big-endian)', () => {
    expect(jpegDimensions(fakeJpeg(65000, 40000))).toEqual({ width: 65000, height: 40000 });
  });

  it('returns null for non-JPEG bytes', () => {
    expect(jpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegDimensions(new Uint8Array([]))).toBeNull();
  });

  it('returns null when no SOF appears before start-of-scan', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0, 0, 0, 0, 0, 0]);
    expect(jpegDimensions(bytes)).toBeNull();
  });
});
