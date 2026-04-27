import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/require-user.js';
import { listUserLanguages, withDefaultsForAllLanguages } from '$lib/server/profile.js';
import { LANGUAGES } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const persisted = await listUserLanguages(user.id);
  return json({
    languages: withDefaultsForAllLanguages(persisted).map((row) => ({
      ...row,
      displayName: LANGUAGES[row.code].displayName,
      nativeName: LANGUAGES[row.code].nativeName,
      script: LANGUAGES[row.code].script,
      supportedRomanizations: LANGUAGES[row.code].supportedRomanizations,
    })),
  });
};
