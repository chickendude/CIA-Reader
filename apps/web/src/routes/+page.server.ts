import { nlpClient } from '$lib/server/nlp-client.js';
import { SUPPORTED_LANGUAGE_CODES, LANGUAGES } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  let nlpStatus: 'ok' | 'down' = 'down';
  let nlpLanguages: string[] = [];
  try {
    const health = await nlpClient.health();
    nlpStatus = health.status === 'ok' ? 'ok' : 'down';
    nlpLanguages = health.languages;
  } catch (err) {
    console.error('NLP health check failed:', err);
  }

  return {
    nlpStatus,
    nlpLanguages,
    languages: SUPPORTED_LANGUAGE_CODES.map((code) => ({
      code,
      displayName: LANGUAGES[code].displayName,
      nativeName: LANGUAGES[code].nativeName,
      script: LANGUAGES[code].script,
    })),
    user: locals.user
      ? {
          id: locals.user.id,
          email: locals.user.email,
          displayName: locals.user.displayName,
          role: locals.user.role,
        }
      : null,
  };
};
