import { env } from '$env/dynamic/private';

export const NLP_SERVICE_URL = env.NLP_SERVICE_URL ?? 'http://localhost:8000';
export const DATABASE_URL =
  env.DATABASE_URL ?? 'postgres://ciareader:ciareader@localhost:5432/ciareader';
export const REDIS_URL = env.REDIS_URL ?? 'redis://localhost:6379';
