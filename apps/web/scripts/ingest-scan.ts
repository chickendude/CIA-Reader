/**
 * Operator CLI: ingest a public-domain dictionary scan volume (PDF)
 * into scan_volumes/scan_pages for the transcription workbench.
 *
 *   pnpm scan:ingest <dict-slug> <volume.pdf> --volume 1 --page-offset -12 \
 *     --printed-start 1 --printed-end 1428 --source-url <archive.org URL> \
 *     [--dpi 200] [--force]
 *
 * Prerequisite: poppler (`brew install poppler` / `apt install
 * poppler-utils`) — pages are rasterized with pdftoppm to grayscale
 * JPEG. Idempotent: already-ingested pages are skipped unless --force,
 * so a killed run resumes. Record --source-url in
 * docs/dictionary-sources.md's scan ledger.
 *
 * Calibration: printed page = pdf page index + --page-offset. Verify
 * with the workbench's "view printed page N" check afterwards.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../src/lib/server/db/schema.js';
import { findScanDictionary } from '../src/lib/server/scans/registry.js';
import { runScanIngest } from '../src/lib/server/scans/ingest.js';
import type { IngestRepo } from '../src/lib/server/scans/ingest.js';
import { getPdfStorage, scanPageStorageKey } from '../src/lib/server/pdf/storage.js';

const execFileAsync = promisify(execFile);

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ciareader:ciareader@localhost:5432/ciareader';

function usage(): never {
  console.error(
    'usage: pnpm scan:ingest <dict-slug> <volume.pdf> --volume N --page-offset K ' +
      '--source-url URL [--printed-start A --printed-end B] [--source-note TEXT] [--dpi 200] [--force]',
  );
  process.exit(1);
}

async function requireTool(tool: string): Promise<void> {
  try {
    await execFileAsync(tool, ['-v']);
  } catch {
    console.error(`${tool} not found — install poppler (brew install poppler / apt install poppler-utils)`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args[0];
  const pdfPath = args[1];
  if (!slug || !pdfPath || slug.startsWith('--') || pdfPath.startsWith('--')) usage();
  const config = findScanDictionary(slug);
  if (!config) {
    console.error(`unknown dictionary slug '${slug}'`);
    usage();
  }
  if (!existsSync(pdfPath)) {
    console.error(`no such file: ${pdfPath}`);
    process.exit(1);
  }

  let volumeNumber = 1;
  let pageOffset: number | undefined;
  let printedStart: number | undefined;
  let printedEnd: number | undefined;
  let sourceUrl: string | undefined;
  let sourceNote: string | undefined;
  let dpi = 200;
  let force = false;
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i]!;
    const next = (): string => args[++i] ?? usage();
    if (arg === '--volume') volumeNumber = Number(next());
    else if (arg === '--page-offset') pageOffset = Number(next());
    else if (arg === '--printed-start') printedStart = Number(next());
    else if (arg === '--printed-end') printedEnd = Number(next());
    else if (arg === '--source-url') sourceUrl = next();
    else if (arg === '--source-note') sourceNote = next();
    else if (arg === '--dpi') dpi = Number(next());
    else if (arg === '--force') force = true;
    else usage();
  }
  if (pageOffset === undefined || !Number.isFinite(pageOffset)) {
    console.error('--page-offset is required (printed page = pdf index + offset)');
    process.exit(1);
  }
  if (!sourceUrl) {
    console.error('--source-url is required (provenance — record it in docs/dictionary-sources.md)');
    process.exit(1);
  }
  if (!Number.isInteger(volumeNumber) || volumeNumber < 1 || !Number.isFinite(dpi) || dpi < 72) usage();

  await requireTool('pdftoppm');
  await requireTool('pdfinfo');

  const client = postgres(DATABASE_URL, { max: 2, idle_timeout: 5 });
  const db = drizzle(client, { schema });
  const storage = getPdfStorage();
  const tmp = mkdtempSync(join(tmpdir(), 'scan-ingest-'));

  const repo: IngestRepo = {
    async upsertVolume(input) {
      const rows = await db
        .insert(schema.scanVolumes)
        .values({
          dictionarySlug: input.dictionarySlug,
          volumeNumber: input.volumeNumber,
          sourceUrl: input.sourceUrl,
          sourceNote: input.sourceNote ?? null,
          pageCount: input.pageCount,
          pageOffset: input.pageOffset,
          printedPageStart: input.printedPageStart ?? null,
          printedPageEnd: input.printedPageEnd ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.scanVolumes.dictionarySlug, schema.scanVolumes.volumeNumber],
          set: {
            sourceUrl: input.sourceUrl,
            sourceNote: input.sourceNote ?? null,
            pageCount: input.pageCount,
            pageOffset: input.pageOffset,
            printedPageStart: input.printedPageStart ?? null,
            printedPageEnd: input.printedPageEnd ?? null,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.scanVolumes.id, pageCount: schema.scanVolumes.pageCount });
      return rows[0]!;
    },
    async hasPage(volumeId, pdfPageIndex) {
      const rows = await db
        .select({ id: schema.scanPages.id })
        .from(schema.scanPages)
        .where(
          and(
            eq(schema.scanPages.volumeId, volumeId),
            eq(schema.scanPages.pdfPageIndex, pdfPageIndex),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async upsertPage(input) {
      await db
        .insert(schema.scanPages)
        .values(input)
        .onConflictDoUpdate({
          target: [schema.scanPages.volumeId, schema.scanPages.pdfPageIndex],
          set: {
            printedPage: input.printedPage,
            imageKey: input.imageKey,
            imageMime: input.imageMime,
            width: input.width,
            height: input.height,
            // A re-rasterized image invalidates the cached OCR.
            ocrStatus: 'pending',
            ocrText: null,
            ocrWords: null,
            ocrEngine: null,
            ocrAt: null,
          },
        });
    },
  };

  try {
    const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);

    console.log(`[ingest] ${slug} volume ${volumeNumber}: ${pages} pdf pages at ${dpi} DPI`);
    const summary = await runScanIngest(
      {
        dictionarySlug: slug,
        volumeNumber,
        pageOffset,
        printedStart,
        printedEnd,
        sourceUrl,
        sourceNote,
        dpi,
        force,
      },
      {
        pageCount: async () => pages,
        async rasterizePage(pdfPageIndex, r) {
          // pdftoppm pages are 1-based; -singlefile writes exactly <prefix>.jpg.
          const page = String(pdfPageIndex + 1);
          const prefix = join(tmp, 'page');
          await execFileAsync('pdftoppm', [
            '-jpeg', '-jpegopt', 'quality=80', '-gray',
            '-r', String(r), '-f', page, '-l', page, '-singlefile',
            pdfPath, prefix,
          ]);
          return new Uint8Array(readFileSync(`${prefix}.jpg`));
        },
        storeImage: (key, bytes, mime) => storage.put(key, bytes, mime),
        imageKeyFor: (pdfPageIndex, mime) =>
          scanPageStorageKey(slug, volumeNumber, pdfPageIndex, mime),
        repo,
        log: (m) => console.log(m),
      },
    );
    console.log(
      `[ingest] done — ${summary.written} pages written, ${summary.skipped} already present ` +
        `(of ${summary.pages})`,
    );
    console.log(`[ingest] reminder: record the scan source in docs/dictionary-sources.md (${sourceUrl})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
