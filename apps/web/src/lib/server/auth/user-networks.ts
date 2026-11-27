import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { desc, eq, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { AUTH_SECRET } from '../env.js';

export const networkCutoff = sql`now() - interval '48 hours'`;

// Keep today and the preceding six UTC dates, matching the moderation counts.
export const signupRetryCutoff = sql`(now() at time zone 'UTC')::date - 6`;

export function networkKey(getClientAddress: () => string): string | null {
  let address: string;
  try {
    address = getClientAddress();
  } catch {
    return null;
  }
  const family = isIP(address);
  if (!family) return null;
  if (family === 6) {
    address = new URL(`http://[${address.split('%')[0]}]/`).hostname.slice(1, -1);
    // Some servers expose IPv4 peers as IPv4-mapped IPv6 addresses.
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(address);
    if (mapped) {
      const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
      address = [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
  }
  return createHmac('sha256', AUTH_SECRET).update('user-network\0' + address).digest('hex');
}

export async function recordNetwork(userId: string, getClientAddress: () => string, signup: boolean) {
  const network = networkKey(getClientAddress);
  if (!network) return;
  const now = sql`statement_timestamp()`;
  await db.insert(schema.userNetworks).values({ userId, network, signupAt: signup ? now : null })
    .onConflictDoUpdate({
      target: [schema.userNetworks.userId, schema.userNetworks.network],
      set: { lastSeenAt: sql`greatest(${schema.userNetworks.lastSeenAt}, ${now})` },
    });
}

export async function purgeExpiredAuthActivity() {
  await db.delete(schema.userNetworks).where(lt(schema.userNetworks.lastSeenAt, networkCutoff));
  await db.delete(schema.signupRetries).where(lt(schema.signupRetries.day, signupRetryCutoff));
  await db.delete(schema.signupWindows).where(lt(schema.signupWindows.expiresAt, sql`now()`));
  await db.delete(schema.passwordFailures).where(lt(schema.passwordFailures.expiresAt, sql`now()`));
}

const { blockedNetworks } = schema;

export async function isNetworkBlocked(network: string) {
  return (await db.$count(blockedNetworks, eq(blockedNetworks.network, network))) > 0;
}

export function listBlockedNetworks() {
  return db.select().from(blockedNetworks).orderBy(desc(blockedNetworks.blockedAt), blockedNetworks.network);
}

export function blockNetwork(network: string) {
  return db.insert(blockedNetworks).values({ network }).onConflictDoNothing();
}

export function unblockNetwork(network: string) {
  return db.delete(blockedNetworks).where(eq(blockedNetworks.network, network));
}
