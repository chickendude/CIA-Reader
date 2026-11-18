import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user.js';
import { reviewTokenWithAi } from '$lib/server/texts/hindi-review.js';
import { ContextChoiceError } from '$lib/server/texts/hindi-context.js';
import { OpenAiNotConfiguredError } from '$lib/server/openai-client.js';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!z.string().uuid().safeParse(event.params.id).success) throw error(404, 'Word not found');
  try {
    return json(await reviewTokenWithAi(event.params.id, user));
  } catch (e) {
    if (e instanceof ContextChoiceError) throw error(e.status, e.message);
    if (e instanceof OpenAiNotConfiguredError)
      throw error(503, 'Configure OPENAI_API_KEY to enable AI verification');
    throw error(502, e instanceof Error ? e.message : 'AI verification failed');
  }
};
