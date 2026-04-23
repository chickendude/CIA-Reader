import { hash, verify } from '@node-rs/argon2';

// argon2id parameters tuned for interactive login (~50–100ms on modern CPU).
// If you bump the cost, also bump the minimum acceptable cost in `verifyPassword`
// so older hashes get silently rehashed on next login.
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(stored: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(stored, plaintext);
  } catch {
    // Malformed hash → reject rather than throw so callers see a clean boolean.
    return false;
  }
}
