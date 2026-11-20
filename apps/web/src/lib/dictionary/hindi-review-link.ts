export function hindiReviewHref(from: URL, textId?: string) {
  const params = new URLSearchParams({ returnTo: from.pathname + from.search + from.hash });
  if (textId) params.set('textId', textId);
  return `/moderation/hindi?${params}`;
}

export function reviewDestination(url: URL) {
  const raw = url.searchParams.get('returnTo');
  if (raw?.startsWith('/') && URL.canParse(raw, url.origin)) {
    const target = new URL(raw, url.origin);
    if (target.origin === url.origin && !target.pathname.startsWith('//')) {
      const parent = target.pathname.startsWith('/reader/') ? 'reader'
        : target.pathname.endsWith('/workshop') || target.pathname === '/dictionary/hi/review' ? 'dictionary workshop'
        : target.pathname === '/moderation/dictionary' ? 'dictionary moderation'
        : target.pathname.startsWith('/library/') ? 'book details'
        : 'Hindi dictionary';
      return { href: target.pathname + target.search + target.hash, label: `Return to ${parent}` };
    }
  }
  return { href: '/dictionary/hi', label: 'Return to Hindi dictionary' };
}
