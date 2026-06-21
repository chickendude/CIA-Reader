/**
 * Build the reader URL that mirrors the current reading position.
 *
 * The reader keeps `?mode`, `?chapter`, `?token` (and `?roman`) in the address
 * bar so a refresh / share resumes exactly where you were. Critically it also
 * strips `?endOfChapter` — that param is a ONE-SHOT cross-text "prev" handoff
 * (it opens a text at its last page on arrival). Left in the URL it would make
 * every refresh re-jump to the last page instead of resuming the page the
 * reader actually reports, so we always drop it once we have a real anchor.
 *
 * Pure (string in, string out) so it's unit-testable without a DOM/History.
 */
export function buildReaderAnchorUrl(
  href: string,
  opts: {
    mode: string;
    chapterIdx: number;
    tokenIdx: number;
    showRomanization: boolean;
  },
): string {
  const url = new URL(href);
  url.searchParams.set('mode', opts.mode);
  url.searchParams.set('chapter', String(opts.chapterIdx));
  url.searchParams.set('token', String(opts.tokenIdx));
  // One-shot handoff — never persist it past the first real anchor.
  url.searchParams.delete('endOfChapter');
  if (opts.showRomanization) url.searchParams.set('roman', '1');
  else url.searchParams.delete('roman');
  return url.toString();
}
