/**
 * WebVTT parsing.
 *
 * Primeran serves one standalone `.vtt` per language holding every cue for the
 * episode (verified against a real 791-cue file). Cue text is wrapped in
 * `<c.white>…</c>` colour tags and a cue is often two lines (two speakers, or a
 * sentence continued). We strip all `<…>` tags and join a cue's lines with a
 * space; the cue text is the sentence context for look-ups and Anki cards.
 */
export type SubtitleCue = {
  startMs: number;
  endMs: number;
  text: string;
};

function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(':').map(Number);
  let h = 0;
  let m = 0;
  let s = 0;
  if (parts.length === 3) [h, m, s] = parts as [number, number, number];
  else if (parts.length === 2) [m, s] = parts as [number, number];
  else s = parts[0] ?? 0;
  return Math.round(((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000);
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWebVtt(input: string): SubtitleCue[] {
  const normalized = input.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue; // WEBVTT header / NOTE / STYLE / cue-id-only

    const timing = lines[arrowIdx] ?? '';
    const match = timing.match(/(\S+)\s*-->\s*(\S+)/);
    if (!match) continue;
    const startRaw = match[1];
    const endRaw = match[2];
    if (!startRaw || !endRaw) continue;

    const text = stripTags(lines.slice(arrowIdx + 1).join(' '));
    if (!text) continue;

    cues.push({ startMs: parseTimestamp(startRaw), endMs: parseTimestamp(endRaw), text });
  }

  return cues;
}

/** The cue active at `timeMs` (last cue whose window contains it), or null. */
export function activeCueAt(cues: SubtitleCue[], timeMs: number): SubtitleCue | null {
  let active: SubtitleCue | null = null;
  for (const cue of cues) {
    if (cue.startMs <= timeMs && timeMs < cue.endMs) active = cue;
    if (cue.startMs > timeMs) break;
  }
  return active;
}
