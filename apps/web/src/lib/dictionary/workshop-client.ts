import type { LanguageCode } from '@ciareader/shared-types';
import { workshopPath } from './profiles';

export async function workshop<T>(
  action: string,
  fields: Record<string, unknown>,
  signal: AbortSignal | undefined,
  language: LanguageCode,
): Promise<T> {
  const r = await fetch(workshopPath(language) + '/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
    signal,
  });
  if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).message ?? 'Dictionary request failed');
  return r.json();
}
