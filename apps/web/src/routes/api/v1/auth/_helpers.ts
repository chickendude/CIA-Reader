import { z } from 'zod';
import { error } from '@sveltejs/kit';
import type { User } from '$lib/server/db/schema.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

export const passwordSchema = z.string().min(10).max(256);

export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw error(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    themePreference: user.themePreference,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

export function isSecureRequest(url: URL): boolean {
  return url.protocol === 'https:';
}
