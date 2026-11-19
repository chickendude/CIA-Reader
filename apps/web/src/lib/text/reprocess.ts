import type { PushToastInput, ToastStore } from '$lib/components/toast/toast-store.js';

export type ReprocessProgress = (completed: number, total: number) => void;

export type ReprocessUpdate =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'complete'; tokensWritten: number; wordsParsed: number }
  | { type: 'error'; message: string };

export async function reprocessWithProgress(
  textId: string,
  onProgress: ReprocessProgress,
): Promise<number> {
  const response = await fetch(`/api/v1/admin/texts/${textId}/reprocess`, {
    method: 'POST',
    headers: { accept: 'application/x-ndjson' },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || `Could not start reprocessing (HTTP ${response.status}).`);
  }
  if (!response.body) throw new Error('No reprocessing updates received.');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed before reprocessing was confirmed.');
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const update: ReprocessUpdate = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (update.type === 'complete') return update.wordsParsed;
        if (update.type === 'error') throw new Error(update.message);
        onProgress(update.completed, update.total);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function reprocessWithToast(
  text: { id: string; title: string; sourceType: string },
  { pushToast, updateToast }: ToastStore,
): Promise<boolean> {
  const pdf = text.sourceType === 'pdf';
  const label = pdf ? 'Pages parsed' : 'Chapters parsed';
  const toastId = pushToast({
    message: 'Preparing to parse…', duration: null, progress: { label, max: 1 },
  });
  let result: PushToastInput;
  try {
    const words = await reprocessWithProgress(text.id, (completed, total) => {
      updateToast(toastId, {
        message: completed < total
          ? `Parsing ${pdf ? 'page' : 'chapter'} ${completed + 1} of ${total}…`
          : 'Finishing up…',
        duration: null,
        progress: { label, value: completed, max: total || 1 },
      });
    });
    result = {
      kind: 'success',
      message: `Reprocessed ${text.title}. Parsed ${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}.`,
    };
  } catch (e) {
    result = { kind: 'error', message: (e as Error).message };
  }
  if (!updateToast(toastId, result)) pushToast(result);
  return result.kind === 'success';
}
