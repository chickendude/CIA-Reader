import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ciareader:ciareader@localhost:5432/ciareader',
  },
  strict: true,
  verbose: true,
} satisfies Config;
