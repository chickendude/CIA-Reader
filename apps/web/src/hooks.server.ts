import { redirect, type Handle } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { purgeExpiredNetworks } from '$lib/server/auth/user-networks.js';
import { resolveUser } from '$lib/server/auth/require-user.js';
import { shouldRedirectToOnboarding } from '$lib/server/onboarding.js';
import {
  THEME_COOKIE,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '$lib/theme/index.js';
import { setJobDispatcher } from '$lib/server/texts/jobs.js';
import { inProcessDispatcher } from '$lib/server/texts/in-process-dispatcher.js';

// Register the in-process NLP dispatcher at module load. Until
// services/nlp's arq worker is deployed, the SvelteKit
// process does the NLP work itself — fire-and-forget per upload —
// and writes tokens back via the same JobDispatcher seam the arq
// worker will plug into later.
setJobDispatcher(inProcessDispatcher);

/**
 * Server-side theme resolution. Mirror of the pre-paint script in app.html so
 * the rendered HTML already carries the right `data-theme` value and the
 * client-side script just confirms it.
 *
 * Sources, in priority order:
 *  1. Authenticated user's `themePreference` on the users table (written by
 *     the profile form). Users who change their preference on one device get
 *     the right theme on every device.
 *  2. `cia_theme` cookie (set by the profile form too; also covers logged-out
 *     visitors who've picked a theme).
 *  3. The `Sec-CH-Prefers-Color-Scheme` client hint, if the browser sent one
 *     (Chromium sends it when requested via an Accept-CH header, so in
 *     practice this is only populated after the first response — a cookie is
 *     more reliable but we accept the hint as a fallback).
 *  4. Default to 'light' (light-mode systems without a cookie or hint won't
 *     flip when the client-side script runs).
 */
function themePreference(event: Parameters<Handle>[0]['event']): ThemePreference {
  const cookie = event.cookies.get(THEME_COOKIE);
  return event.locals.user?.themePreference ?? (isThemePreference(cookie) ? cookie : 'system');
}

export function resolveServerTheme(event: Parameters<Handle>[0]['event']): ResolvedTheme {
  const hint = event.request.headers.get('sec-ch-prefers-color-scheme');
  const systemPrefersDark = hint === 'dark';
  return resolveTheme(themePreference(event), systemPrefersDark);
}

function compressChapterData(response: Response, acceptEncoding: string) {
  // Direct connections to the reader also need compression when a chapter has thousands of tokens.
  if (
    response.status !== 200 || !response.body || response.headers.has('content-encoding') ||
    Number(response.headers.get('content-length')) < 1024
  ) return response;

  response.headers.append('vary', 'Accept-Encoding');
  const supportsGzip = acceptEncoding.split(',').some((item) => {
    const [encoding, quality = 'q=1'] = item.trim().toLowerCase().split(/\s*;\s*/);
    return encoding === 'gzip' && Number(quality.replace(/^q=/, '')) > 0;
  });
  if (!supportsGzip) return response;

  const headers = new Headers(response.headers);
  headers.set('content-encoding', 'gzip');
  headers.delete('content-length');
  return new Response(response.body.pipeThrough(new CompressionStream('gzip')), { headers });
}

export function init() {
  if (building) return;
  const purge = () => purgeExpiredNetworks().catch(() => console.error('Could not expire account networks'));
  void purge();
  const timer = setInterval(purge, 60 * 60 * 1000);
  timer.unref();
  import.meta.hot?.dispose(() => clearInterval(timer));
}

export const handle: Handle = async ({ event, resolve }) => {
  // Dev-only CORS for the Primeran browser extension. Its background worker
  // makes authenticated requests (Bearer header → CORS preflight), and SvelteKit
  // otherwise answers the OPTIONS preflight with 405. Gated to `dev` + an
  // extension origin so production and normal browser traffic are untouched.
  const reqOrigin = event.request.headers.get('origin');
  const corsForExtension =
    dev &&
    event.url.pathname.startsWith('/api/') &&
    !!reqOrigin &&
    /^(moz|chrome)-extension:\/\//.test(reqOrigin);

  if (corsForExtension && event.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': reqOrigin!,
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, x-api-key',
        'access-control-max-age': '86400',
      },
    });
  }

  event.locals.user = await resolveUser(event);
  if (shouldRedirectToOnboarding(event.locals.user, event.url.pathname)) {
    throw redirect(303, '/onboarding');
  }
  const theme = resolveServerTheme(event);
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%cia.theme%', theme).replace('%cia.themePreference%', themePreference(event)),
  });
  if (corsForExtension) response.headers.set('access-control-allow-origin', reqOrigin!);
  if (
    (event.isDataRequest && event.route.id === '/reader/[textId]') ||
    event.route.id === '/api/v1/texts/[id]/chapters/[idx]/tokens'
  ) {
    return compressChapterData(response, event.request.headers.get('accept-encoding') ?? '');
  }
  return response;
};
