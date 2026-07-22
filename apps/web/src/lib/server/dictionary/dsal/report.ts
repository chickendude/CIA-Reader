/**
 * Parse-run reporting: turns per-file parse stats into the summary the
 * operator reads before deciding an import is trustworthy.
 *
 * Two completeness signals, both free:
 *  - every results page declares its own "N results" count, so declared
 *    vs parsed per file catches parser drift or truncated downloads;
 *  - the final deduped total is checked against the per-dictionary
 *    expected range from config, so a sweep that silently lost letters
 *    is flagged before anyone runs the importer.
 */
import type { DsalDictionaryConfig } from './config.js';
import type { ParseStats } from './parse.js';

export type PerFileStats = {
  fileName: string;
  stats: ParseStats;
};

export type ParseReport = {
  lines: string[];
  warnings: string[];
};

export function buildParseReport(
  config: DsalDictionaryConfig,
  perFile: PerFileStats[],
  finalCount: number,
  duplicatesDropped: number,
): ParseReport {
  const lines: string[] = [];
  const warnings: string[] = [];

  let blocks = 0;
  let parsed = 0;
  let noDevanagari = 0;
  let dropped = 0;

  for (const { fileName, stats } of perFile) {
    blocks += stats.blocks;
    parsed += stats.parsed;
    noDevanagari += stats.noDevanagari;
    dropped += stats.noHeadword + stats.noBody;
    const declared = stats.declaredResults;
    const marker = declared !== null && declared !== stats.blocks ? '  ⚠ declared≠blocks' : '';
    lines.push(
      `  ${fileName}: ${stats.parsed}/${stats.blocks} parsed` +
        (declared !== null ? ` (page declares ${declared})` : '') +
        marker,
    );
    if (declared !== null && declared !== stats.blocks) {
      warnings.push(
        `${fileName}: page declares ${declared} results but ${stats.blocks} entry blocks were found — truncated download or markup drift`,
      );
    }
  }

  lines.push(
    `${config.slug}: ${parsed} parsed from ${blocks} blocks across ${perFile.length} files; ` +
      `${duplicatesDropped} duplicates dropped → ${finalCount} records`,
  );
  if (noDevanagari > 0) {
    const pct = blocks === 0 ? 0 : Math.round((noDevanagari / blocks) * 1000) / 10;
    lines.push(
      `${config.slug}: ${noDevanagari} entries (${pct}%) skipped — no Devanagari orthography`,
    );
  }
  if (dropped > 0) {
    lines.push(`${config.slug}: ${dropped} blocks dropped (missing headword or body)`);
  }

  const [min, max] = config.expectedEntryCountRange;
  if (finalCount < min || finalCount > max) {
    warnings.push(
      `${config.slug}: ${finalCount} records is outside the expected ${min}–${max} range — ` +
        `check the scrape covered every letter before importing`,
    );
  }

  return { lines, warnings };
}
