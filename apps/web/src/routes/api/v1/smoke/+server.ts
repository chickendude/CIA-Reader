import { json, error } from '@sveltejs/kit';
import { nlpClient } from '$lib/server/nlp-client.js';
import type { RequestHandler } from './$types';

/** Checks whether the web server can reach the NLP service and read its response. */
export const GET: RequestHandler = async () => {
  try {
    const health = await nlpClient.health();
    const canned = await nlpClient.process('hi', 'नमस्ते दुनिया');
    return json({
      ok: true,
      nlp_health: health,
      sample_process: {
        language: canned.language,
        pipeline_id: canned.pipeline_id,
        token_count: canned.tokens.length,
        first_token: canned.tokens[0] ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw error(502, `NLP service unreachable: ${message}`);
  }
};
