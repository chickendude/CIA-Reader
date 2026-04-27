import { SignJWT, jwtVerify } from 'jose';
import { AUTH_SECRET } from '../env.js';

const ISSUER = 'ciareader';
const AUDIENCE = 'ciareader-api';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

const secretKey = new TextEncoder().encode(AUTH_SECRET);

export interface AccessTokenPayload {
  sub: string; // user id
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export const ACCESS_TOKEN_TTL = ACCESS_TOKEN_TTL_SECONDS;
