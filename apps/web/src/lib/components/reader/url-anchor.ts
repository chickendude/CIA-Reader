/** Link to a reader position. A collection sibling can be addressed by text ID alone. */
export function readerChapterHref(textId: string, chapterIdx: number | null, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if (chapterIdx !== null) query.set('chapterNumber', String(chapterIdx + 1));
  return `/reader/${encodeURIComponent(textId)}?${query}`;
}

/**
 * Build the reader URL that mirrors the current reading position.
 *
 * The reader keeps `?mode`, `?chapterNumber`, `?token` (and `?roman`) in the address
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
    chapterIdx: number | null;
    tokenIdx: number;
    showRomanization: boolean;
  },
): string {
  const url = new URL(href);
  url.searchParams.set('mode', opts.mode);
  url.searchParams.delete('chapter');
  if (opts.chapterIdx === null) url.searchParams.delete('chapterNumber');
  else url.searchParams.set('chapterNumber', String(opts.chapterIdx + 1));
  url.searchParams.set('token', String(opts.tokenIdx));
  // One-shot handoff — never persist it past the first real anchor.
  url.searchParams.delete('endOfChapter');
  if (opts.showRomanization) url.searchParams.set('roman', '1');
  else url.searchParams.delete('roman');
  return url.toString();
}
