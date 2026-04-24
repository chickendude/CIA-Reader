import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { InferSelectModel } from 'drizzle-orm';

export const userRole = pgEnum('user_role', ['user', 'curator', 'admin']);
export const themePreference = pgEnum('theme_preference', ['system', 'light', 'dark']);

// MVP languages. Kept in sync with @ciareader/shared-types' LanguageCode;
// adding a new language means extending both sides in lockstep. The registry
// is the human-facing source of truth, but Postgres needs its own enum so
// FK-like integrity is enforced at the DB layer.
export const language = pgEnum('language', ['hi', 'mr', 'or']);

// Romanization schemes a user can pick. Subset of the registry's
// RomanizationScheme — the DB only needs to store choices users can make.
export const romanizationScheme = pgEnum('romanization_scheme', [
  'iso15919',
  'iast',
  'hunterian',
  'itrans',
]);

// What the learner wants rendered in the reader: pure native script, script
// with inline romanization above each word, or romanization-only (training
// wheels for brand-new readers). Defaults to 'native'.
export const scriptPreference = pgEnum('script_preference', [
  'native',
  'native_with_romanization',
  'romanization_only',
]);

// Three reader layout modes per the plan (M5). Stored per-language so a
// user can prefer `page` for Hindi but `continuous` for Odia.
export const readerLayoutMode = pgEnum('reader_layout_mode', [
  'page',
  'paged_scroll',
  'continuous',
]);

export const highlightStyle = pgEnum('highlight_style', [
  'underline',
  'background',
  'colored_text',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    role: userRole('role').notNull().default('user'),
    displayName: text('display_name'),
    themePreference: themePreference('theme_preference').notNull().default('system'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

/**
 * Web session cookie. `id` is the SHA-256 of the cookie value; the cookie
 * itself is never stored in the DB. A session is revoked by deleting its row.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
);

/**
 * Long-lived refresh token for bearer-auth clients (mobile / API). `id` is the
 * SHA-256 of the token; the plaintext is returned to the client once on issue.
 * Rotation: on `/auth/refresh`, the current row is marked `revokedAt` and a
 * new row is created; `replacedBy` lets us detect token-reuse attacks.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: text('replaced_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('refresh_tokens_user_idx').on(t.userId),
    expiresIdx: index('refresh_tokens_expires_idx').on(t.expiresAt),
  }),
);

/**
 * Magic-link login tokens. Single-use. `id` is the SHA-256 of the token; the
 * plaintext only appears in the emailed URL.
 */
export const magicLinks = pgTable(
  'magic_links',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('magic_links_user_idx').on(t.userId),
    expiresIdx: index('magic_links_expires_idx').on(t.expiresAt),
  }),
);

/**
 * Per-user, per-language preferences. A row is created the first time a user
 * engages with a given language (onboarding in T-1.5, or first text import).
 * Reader layout + typography live here because they're language-specific —
 * a Devanagari font shortlist doesn't apply to Odia.
 *
 * `knownWordsCountCache` is a denormalized count over `user_known_lemmas`
 * (added in a later milestone) so the stats page doesn't need a GROUP BY on
 * every page load. Refreshed whenever a lemma's status changes.
 */
export const userLanguages = pgTable(
  'user_languages',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    language: language('language').notNull(),
    scriptPreference: scriptPreference('script_preference').notNull().default('native'),
    romanizationScheme: romanizationScheme('romanization_scheme').notNull().default('iso15919'),
    knownWordsCountCache: integer('known_words_count_cache').notNull().default(0),
    readerLayoutMode: readerLayoutMode('reader_layout_mode').notNull().default('page'),
    wordsPerPage: integer('words_per_page').notNull().default(250),
    fontFamily: text('font_family'),
    fontSize: real('font_size').notNull().default(18),
    lineSpacing: real('line_spacing').notNull().default(1.6),
    highlightStyle: highlightStyle('highlight_style').notNull().default('background'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.language] }),
  }),
);

export type User = InferSelectModel<typeof users>;
export type Session = InferSelectModel<typeof sessions>;
export type RefreshToken = InferSelectModel<typeof refreshTokens>;
export type MagicLink = InferSelectModel<typeof magicLinks>;
export type UserLanguage = InferSelectModel<typeof userLanguages>;
