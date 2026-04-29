// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isAllowedAudioMime,
  newAudioStorageKey,
  MAX_AUDIO_BYTES,
} from './storage.js';

describe('isAllowedAudioMime', () => {
  it('accepts MP3 / M4A / OGG / WebM', () => {
    expect(isAllowedAudioMime('audio/mpeg')).toBe(true);
    expect(isAllowedAudioMime('audio/m4a')).toBe(true);
    expect(isAllowedAudioMime('audio/ogg')).toBe(true);
    expect(isAllowedAudioMime('audio/webm')).toBe(true);
  });

  it('rejects video / non-audio types', () => {
    expect(isAllowedAudioMime('video/mp4')).toBe(false);
    expect(isAllowedAudioMime('text/plain')).toBe(false);
    expect(isAllowedAudioMime('application/octet-stream')).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(isAllowedAudioMime('AUDIO/MPEG')).toBe(true);
  });
});

describe('newAudioStorageKey', () => {
  it('namespaces uploads by text id and includes the random id', () => {
    const k = newAudioStorageKey(
      'text-1',
      'chapter-1.mp3',
      'rand-abc',
    );
    expect(k).toBe('texts/text-1/rand-abc.mp3');
  });

  it('preserves a recognised extension and lowercases it', () => {
    const k = newAudioStorageKey('t', 'Track.M4A', 'r');
    expect(k.endsWith('.m4a')).toBe(true);
  });

  it('drops a suspicious / empty extension', () => {
    expect(newAudioStorageKey('t', 'no-ext', 'r')).toBe('texts/t/r');
    // Path-traversal attempt → ext is empty, no traversal in the key.
    const evil = newAudioStorageKey('t', '../../etc/passwd.mp3', 'r');
    expect(evil).toBe('texts/t/r.mp3');
    expect(evil).not.toMatch(/\.\./);
  });
});

describe('MAX_AUDIO_BYTES', () => {
  it('caps at 80MB', () => {
    expect(MAX_AUDIO_BYTES).toBe(80 * 1024 * 1024);
  });
});
