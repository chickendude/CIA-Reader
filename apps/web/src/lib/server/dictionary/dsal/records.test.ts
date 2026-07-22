// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  dsalDedupeKey,
  finalizeRecords,
  parseDsalRecordLine,
  serializeDsalRecord,
} from './records.js';
import type { DsalRecord } from './records.js';

const base = {
  slug: 'dsal-molesworth' as const,
  hw: 'विज्ञान',
  senses: ['Knowledge, science.'],
  page: 767,
};

describe('dsalDedupeKey', () => {
  it('is stable for identical printed entries', () => {
    expect(dsalDedupeKey({ ...base })).toBe(dsalDedupeKey({ ...base }));
  });

  it('distinguishes same headword on different pages', () => {
    expect(dsalDedupeKey({ ...base })).not.toBe(dsalDedupeKey({ ...base, page: 768 }));
  });

  it('distinguishes homographs with different senses', () => {
    expect(dsalDedupeKey({ ...base })).not.toBe(
      dsalDedupeKey({ ...base, senses: ['A different first sense entirely.'] }),
    );
  });
});

describe('finalizeRecords', () => {
  it('drops duplicates from overlapping letter queries', () => {
    const { records, duplicatesDropped } = finalizeRecords([{ ...base }, { ...base }]);
    expect(records).toHaveLength(1);
    expect(duplicatesDropped).toBe(1);
  });

  it('assigns ascending ordinals to same-page homographs', () => {
    const { records } = finalizeRecords([
      { ...base, senses: ['First homograph.'] },
      { ...base, senses: ['Second homograph.'] },
      { ...base, page: 768, senses: ['Different page.'] },
    ]);
    expect(records.map((r) => r.ord)).toEqual([0, 1, 0]);
  });
});

describe('serialize / parse round trip', () => {
  it('round-trips a full record', () => {
    const rec: DsalRecord = {
      ...base,
      ord: 0,
      hwAlt: ['کمل'],
      translit: 'vijñāna',
      posRaw: 'n',
    };
    expect(parseDsalRecordLine(serializeDsalRecord(rec))).toEqual(rec);
  });

  it('returns null on blank and malformed lines', () => {
    expect(parseDsalRecordLine('')).toBeNull();
    expect(parseDsalRecordLine('   ')).toBeNull();
    expect(parseDsalRecordLine('not-json')).toBeNull();
    expect(parseDsalRecordLine('{"hw":"x"}')).toBeNull();
  });
});
