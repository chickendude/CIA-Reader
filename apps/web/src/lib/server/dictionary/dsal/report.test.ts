// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DSAL_DICTIONARIES } from './config.js';
import { buildParseReport } from './report.js';
import type { ParseStats } from './parse.js';

const stats = (overrides: Partial<ParseStats>): ParseStats => ({
  blocks: 100,
  parsed: 100,
  noDevanagari: 0,
  noHeadword: 0,
  noBody: 0,
  declaredResults: 100,
  ...overrides,
});

describe('buildParseReport', () => {
  const config = DSAL_DICTIONARIES['dsal-molesworth'];

  it('reports per-file counts and no warnings when everything lines up', () => {
    const report = buildParseReport(
      config,
      [{ fileName: 'q-000-अ.html', stats: stats({}) }],
      60_000,
      0,
    );
    expect(report.warnings).toEqual([]);
    expect(report.lines[0]).toContain('100/100 parsed');
  });

  it('warns when the page-declared result count disagrees with parsed blocks', () => {
    const report = buildParseReport(
      config,
      [{ fileName: 'q-000-अ.html', stats: stats({ declaredResults: 120 }) }],
      60_000,
      0,
    );
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('declares 120 results but 100 entry blocks');
  });

  it('warns when the deduped total falls outside the expected range', () => {
    const report = buildParseReport(config, [{ fileName: 'q.html', stats: stats({}) }], 12, 0);
    expect(report.warnings.some((w) => w.includes('outside the expected'))).toBe(true);
  });

  it('reports the Platts no-Devanagari skip percentage', () => {
    const platts = DSAL_DICTIONARIES['dsal-platts'];
    const report = buildParseReport(
      platts,
      [{ fileName: 'q-000-a.html', stats: stats({ parsed: 75, noDevanagari: 25 }) }],
      30_000,
      0,
    );
    expect(report.lines.some((l) => l.includes('25 entries (25%) skipped'))).toBe(true);
  });
});
