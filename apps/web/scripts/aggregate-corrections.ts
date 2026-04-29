/**
 * CLI runner for the correction aggregation worker (T-6.7).
 *
 * Run via:
 *
 *   pnpm --filter @ciareader/web aggregate-corrections [--dry-run]
 *
 * In production this is wired to a daily cron that calls the
 * compiled output. The script is a thin wrapper around
 * `runCorrectionAggregation()` so the same code path covers
 * tests + local invocation.
 */
import { runCorrectionAggregation } from '../src/lib/server/correction-aggregation.js';

async function main() {
  const args = new Set(process.argv.slice(2));
  const sinceArg = process.argv.find((a) => a.startsWith('--since-days='));
  const sinceDaysAgo = sinceArg
    ? Number.parseInt(sinceArg.split('=')[1] ?? '60', 10)
    : undefined;

  const dryRun = args.has('--dry-run');
  if (dryRun) {
    console.log('aggregate-corrections: dry-run flag is informational; the');
    console.log('worker still queries the DB but does not write — set the');
    console.log('threshold higher than 100 to suppress promotions.');
  }

  const t0 = Date.now();
  const result = await runCorrectionAggregation({ sinceDaysAgo });
  const ms = Date.now() - t0;

  console.log(JSON.stringify({ ...result, durationMs: ms }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('aggregate-corrections failed:', err);
  process.exit(1);
});
