import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import type { User, UserLanguage } from './db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type LanguageBaseline = 'none' | 'beginner' | 'intermediate';

const ONBOARDING_PATH = '/onboarding';

/**
 * Routes an onboarded user never needs to be bounced to the onboarding
 * page from. Auth flows, the onboarding page itself, and the API surface
 * (mobile clients handle onboarding their own way) all skip the redirect.
 *
 * Returning a function rather than a regex so future tickets can add
 * conditional rules (e.g. bypass for specific pricing pages) without
 * rewriting the matcher.
 */
export function shouldRedirectToOnboarding(
  user: Pick<User, 'onboardedAt'> | null,
  pathname: string,
): boolean {
  if (!user) return false;
  if (user.onboardedAt !== null) return false;
  if (pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`)) return false;
  if (pathname.startsWith('/api/')) return false;
  if (pathname === '/login' || pathname.startsWith('/login/')) return false;
  if (pathname === '/logout' || pathname.startsWith('/logout/')) return false;
  if (pathname === '/register' || pathname.startsWith('/register/')) return false;
  return true;
}

/**
 * Commits the onboarding choice: upserts a user_languages row carrying the
 * baseline and flips users.onboardedAt. Callers are expected to have
 * already validated the language / baseline against the registry.
 */
export async function completeOnboarding(
  userId: string,
  languageCode: LanguageCode,
  baseline: LanguageBaseline,
): Promise<{ user: User; language: UserLanguage }> {
  const now = new Date();
  // Upsert the user_languages row first. Primary key is (user_id, language),
  // so ON CONFLICT DO UPDATE updates the baseline if the user somehow
  // re-submits (e.g. double-tap on submit) without re-inserting.
  const [lang] = await db
    .insert(schema.userLanguages)
    .values({
      userId,
      language: languageCode,
      baseline,
    })
    .onConflictDoUpdate({
      target: [schema.userLanguages.userId, schema.userLanguages.language],
      set: { baseline, updatedAt: now },
    })
    .returning();
  if (!lang) throw new Error('onboarding upsert returned no row');

  const [user] = await db
    .update(schema.users)
    .set({ onboardedAt: now, updatedAt: now })
    .where(eq(schema.users.id, userId))
    .returning();
  if (!user) throw new Error('user not found');

  return { user, language: lang };
}
