// Offline HindiDB imports use the same stutter rules as web uploads.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { detectStutters, projectStutters } from '../src/lib/server/texts/hindi-stutters.ts';

const input = JSON.parse(readFileSync(0, 'utf8'));
const hash = createHash('sha256').update(input.body).digest('hex');
const previous = input.previous?.stutter_text_hash === hash ? input.previous.stutters : [];
const spans = detectStutters(input.tokens, input.occurrences, previous);
const { stats, prefixes } = projectStutters(input.tokens, input.occurrences, input.stats, spans, hash);
process.stdout.write(JSON.stringify({ stats, prefixes: [...prefixes] }));
