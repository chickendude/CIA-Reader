import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Inventory, WorkshopReport } from '$lib/dictionary/workshop';
import { DATABASE_URL } from '../env.js';

// pnpm runs in apps/web. The production container starts at the workspace root.
const root = existsSync('services/nlp/parhiba_hindi')
  ? resolve('services/nlp')
  : resolve('../../services/nlp');
const localPython = resolve(root, '.venv/bin/python');
const python = existsSync(localPython) ? localPython : 'python3';

export class HindiDictionaryError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

type Response<T> = { status: 200; result: T } | { status: 400 | 404; message: string };

async function run<T>(operation: 'preview' | 'reference' | 'report', request: object) {
  const input = JSON.stringify(request);
  const output = await new Promise<string>((accept, reject) => {
    const child = execFile(
      python,
      ['-B', '-X', 'utf8', '-m', 'parhiba_hindi', operation],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL },
        timeout: operation === 'report' ? 180_000 : 30_000,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout) => (error ? reject(error) : accept(stdout)),
    );
    child.stdin!.on('error', reject);
    child.stdin!.end(input);
  });
  const response: Response<T> = JSON.parse(output);
  if (response.status !== 200) throw new HindiDictionaryError(response.status, response.message);
  return response.result;
}

export function previewHindiEntry(
  entry: Record<string, unknown>,
  options: {
    include_slots?: boolean;
    inventory?: boolean;
    validate_inventory?: boolean;
    phrase?: string;
    phrase_candidates?: boolean;
    negative_variants?: boolean;
  } = {},
) {
  return run<{
    forms: Record<string, string[]>;
    slots?: { label: string; forms: string[] }[];
    inventory?: Inventory;
  }>('preview', { entry, options });
}

export function hindiWorkshopReport(name: string) {
  return run<WorkshopReport>('report', { name });
}

export function hindiReference({
  provider,
  query,
  url,
}: {
  provider?: string;
  query?: string;
  url?: string;
}) {
  return run<unknown>('reference', { provider, query, url });
}
