export async function workshop<T>(
  action: string,
  fields: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch('/moderation/hindi/workshop/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
    signal,
  });
  if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).message ?? 'Dictionary request failed');
  return r.json();
}
