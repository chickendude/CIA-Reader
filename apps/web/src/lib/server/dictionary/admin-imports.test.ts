// @vitest-environment node
/**
 * Cache-status probing tests for the admin sources page (T-3.14).
 *
 * Hits the real filesystem under a tmpdir so the streaming line
 * counter and stat-based probes exercise the actual code path
 * production runs. The DB-touching helpers (`listSourceStatuses`,
 * job triggers) are covered by the page-server test against the
 * registry layer, so they're not duplicated here.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetActiveJobsForTest,
  getDictionaryCacheStatus,
} from './admin-imports.js';

let dataRoot: string;

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'cia-admin-imports-'));
  _resetActiveJobsForTest();
});

afterEach(() => {
  _resetActiveJobsForTest();
});

async function writeRaw(slug: string, body: string): Promise<void> {
  const dir = join(dataRoot, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'raw.jsonl'), body);
}

async function writeTmp(slug: string, body: string): Promise<void> {
  const dir = join(dataRoot, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'raw.jsonl.tmp'), body);
}

describe('getDictionaryCacheStatus', () => {
  it('reports missing when neither raw nor tmp exist', async () => {
    const status = await getDictionaryCacheStatus('nope', dataRoot);
    expect(status.exists).toBe(false);
    expect(status.hasPartial).toBe(false);
    expect(status.state).toBe('missing');
    expect(status.sizeBytes).toBeNull();
    expect(status.lineCount).toBeNull();
    expect(status.mtime).toBeNull();
  });

  it('reports cached + line count when raw.jsonl exists', async () => {
    await writeRaw('kaikki-hindi', 'a\nb\nc\n');
    const status = await getDictionaryCacheStatus('kaikki-hindi', dataRoot);
    expect(status.exists).toBe(true);
    expect(status.state).toBe('cached');
    expect(status.lineCount).toBe(3);
    expect(status.sizeBytes).toBe(6);
    expect(status.mtime).toBeInstanceOf(Date);
  });

  it('counts a final line that lacks a trailing newline as zero new lines', async () => {
    // Match `wc -l` semantics: lines are terminated by `\n`. Two
    // \n bytes ⇒ count is 2 even if there's a partial trailing
    // string. Surfacing the count to the curator should match
    // their shell-side intuition.
    await writeRaw('kaikki-marathi', 'foo\nbar\nbaz');
    const status = await getDictionaryCacheStatus('kaikki-marathi', dataRoot);
    expect(status.lineCount).toBe(2);
  });

  it('reports partial when only raw.jsonl.tmp exists', async () => {
    await writeTmp('kaikki-odia', 'half-done\n');
    const status = await getDictionaryCacheStatus('kaikki-odia', dataRoot);
    expect(status.exists).toBe(false);
    expect(status.hasPartial).toBe(true);
    expect(status.state).toBe('partial');
  });

  it('prefers cached over partial when both files exist', async () => {
    await writeRaw('kaikki-odia', 'a\n');
    await writeTmp('kaikki-odia', 'b\n');
    const status = await getDictionaryCacheStatus('kaikki-odia', dataRoot);
    expect(status.state).toBe('cached');
    expect(status.hasPartial).toBe(true);
  });

  it('treats an empty raw.jsonl as missing', async () => {
    await writeRaw('empty', '');
    const status = await getDictionaryCacheStatus('empty', dataRoot);
    expect(status.exists).toBe(false);
    expect(status.state).toBe('missing');
  });
});
