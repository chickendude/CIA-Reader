import { APP_BASE_URL } from '../env.js';
import type { User } from '../db/schema.js';
import { createMagicLink } from '../auth/magic-link.js';
import { buildMagicLinkEmail, sendMail } from './index.js';

export async function sendAccountLink(
  user: Pick<User, 'id' | 'email' | 'emailVerifiedAt'>,
  purpose: 'signin' | 'verification',
): Promise<'sent' | 'limited'> {
  const token = await createMagicLink(user.id, purpose === 'signin' && !!user.emailVerifiedAt);
  if (!token) return 'limited';
  const url = `${APP_BASE_URL}/auth/magic/${encodeURIComponent(token)}`;
  await sendMail(buildMagicLinkEmail(user.email, url));
  return 'sent';
}
