// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SCAN_DICTIONARIES, findScanDictionary, verifiedAttribution } from './registry.js';
import { scanPageStorageKey, isScanKey } from '../pdf/storage.js';

describe('scan dictionary registry', () => {
  it('covers all four DSAL dictionaries with matching prefixes', () => {
    for (const [slug, config] of Object.entries(SCAN_DICTIONARIES)) {
      expect(config.slug).toBe(slug);
      expect(config.draftSourceIdPrefix).toMatch(/^dsal:[a-z]+:$/);
      expect(config.createdSourceIdPrefix).toMatch(/^transcribe:[a-z]+:$/);
      expect(findScanDictionary(slug)).toBe(config);
    }
    expect(findScanDictionary('nope')).toBeUndefined();
  });

  it('builds the verified attribution with and without a page number', () => {
    const config = SCAN_DICTIONARIES['dsal-praharaj']!;
    expect(verifiedAttribution(config, 495)).toBe(
      'Transcribed from Praharaj, Purnnachandra Ordia Bhashakosha (1931–40), p. 495, from the public-domain scan — CIA Reader transcription',
    );
    expect(verifiedAttribution(config, null)).not.toContain('p.');
  });
});

describe('scan storage keys', () => {
  it('builds volume-padded keys and recognizes them', () => {
    const key = scanPageStorageKey('dsal-praharaj', 3, 42, 'image/jpeg');
    expect(key).toBe('scans/dsal-praharaj/v03/pages/42.jpg');
    expect(isScanKey(key)).toBe(true);
    expect(isScanKey('texts/abc/pages/0.webp')).toBe(false);
  });
});
