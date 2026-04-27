import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate a high-entropy token suitable for session cookies, refresh tokens,
 * and magic-link tokens. 32 bytes = 256 bits = uncrackable. base64url-encoded
 * so it's safe in cookies and URLs.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash a token for storage. We store SHA-256(token), never the raw token.
 * SHA-256 (not argon2) is the right call here: the input is already 256 bits
 * of entropy, so a fast hash is fine and a slow hash is pure overhead.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
