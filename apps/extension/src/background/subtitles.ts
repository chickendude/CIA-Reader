/**
 * Fetch + parse a subtitle file from the background worker. The CDN URL is
 * discovered by the MAIN-world net-intercept shim and forwarded here; fetching
 * from the background (covered by host_permissions) sidesteps page CORS.
 */
import { parseWebVtt, type SubtitleCue } from '../shared/subtitles';

export async function fetchSubtitles(url: string): Promise<SubtitleCue[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subtitle fetch failed: HTTP ${res.status}`);
  return parseWebVtt(await res.text());
}
