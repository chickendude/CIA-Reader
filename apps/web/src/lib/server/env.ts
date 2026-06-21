import { env } from '$env/dynamic/private';

export const NLP_SERVICE_URL = env.NLP_SERVICE_URL ?? 'http://localhost:8000';
export const DATABASE_URL =
  env.DATABASE_URL ?? 'postgres://ciareader:ciareader@localhost:5432/ciareader';
export const REDIS_URL = env.REDIS_URL ?? 'redis://localhost:6379';

export const AUTH_SECRET =
  env.AUTH_SECRET ?? 'dev-only-secret-replace-in-prod-0000000000000000000000000000000';
export const APP_BASE_URL = env.APP_BASE_URL ?? 'http://localhost:5173';

export const SMTP_HOST = env.SMTP_HOST ?? 'localhost';
export const SMTP_PORT = Number(env.SMTP_PORT ?? 1025);
export const SMTP_USER = env.SMTP_USER ?? '';
export const SMTP_PASS = env.SMTP_PASS ?? '';
export const SMTP_FROM = env.SMTP_FROM ?? 'no-reply@ciareader.local';

// OpenAI-compatible chat API — powers sentence-level translation. Empty key
// disables the feature (the endpoint returns 503), so dev works without it.
// `OPENAI_BASE_URL` lets you point at any OpenAI-compatible provider (e.g. a
// free Gemini or Groq endpoint) without code changes — just set the base URL,
// key, and model together.
export const OPENAI_API_KEY = env.OPENAI_API_KEY ?? '';
export const OPENAI_MODEL = env.OPENAI_MODEL ?? 'gpt-4o';
export const OPENAI_BASE_URL = env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
