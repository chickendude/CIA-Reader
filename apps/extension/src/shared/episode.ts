/** Stable per-episode key from a Primeran page URL (ignores the hash). */
export function episodeKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
