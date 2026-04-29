import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
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

/**
 * Per-user reading column width. Drives the max-width of the reader's
 * text column — narrow for tight focus, wide for laptop-screen full-
 * bleed. Stored per-language so a user can prefer wider columns for
 * Devanagari and tighter for Odia (or vice versa). T-5.1b.
 */
export const readingWidth = pgEnum('reading_width', [
  'narrow',
  'medium',
  'wide',
]);

/**
 * Assumed-known baseline captured during onboarding. Used in a future
 * ticket to seed `user_known_lemmas` against frequency_rank buckets —
 * `beginner` pre-marks the top-100 most-frequent lemmas as 'known',
 * `intermediate` the top-1000. At MVP we persist the choice only.
 */
export const languageBaseline = pgEnum('language_baseline', [
  'none',
  'beginner',
  'intermediate',
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
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
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
    readingWidth: readingWidth('reading_width').notNull().default('medium'),
    baseline: languageBaseline('baseline').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.language] }),
  }),
);

/**
 * Where a translation originated. Drives ordering in the reader pop-up:
 * user customizations first (for the acting user only), then officials,
 * then community submissions sorted by vote.
 */
export const translationSource = pgEnum('translation_source', [
  'official_dictionary',
  'curator',
  'user',
]);

/**
 * Dictionary headwords (T-3.1). A lemma is identified by (language, headword,
 * pos) — the same surface may be multiple lemmas across POS (e.g. Hindi "सोना"
 * as noun "gold" vs. verb "to sleep"). `script` is an ISO 15924 code (Deva /
 * Orya / etc.) — redundant with `language` for MVP but kept explicit so Urdu
 * / Sindhi (multi-script) slot in cleanly later.
 *
 * `source_attribution` is the human-readable credit shown in the pop-up and
 * on the browse page (T-3.8). `source_id` is the upstream primary key so a
 * re-import can UPDATE rather than duplicate (idempotency).
 *
 * `curator_locked = true` means "a human has touched this and future
 * imports MUST NOT clobber it." The import runner enforces that invariant;
 * curators can unlock in the dictionary editor (T-3.7) if they want to
 * accept a fresh upstream payload over their edit.
 */
export const lemmas = pgTable(
  'lemmas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    language: language('language').notNull(),
    headword: text('headword').notNull(),
    pos: text('pos').notNull(),
    script: text('script').notNull(),
    glossDefault: text('gloss_default'),
    frequencyRank: integer('frequency_rank'),
    source: translationSource('source').notNull(),
    sourceAttribution: text('source_attribution'),
    sourceId: text('source_id'),
    curatorLocked: boolean('curator_locked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // T-3.10: per-source duplication is allowed by design — Kaikki and
    // IndoWordNet may both ship "किताब/NOUN" and we keep both rows so a
    // curator can reconcile via the existing T-3.7 merge UI. The
    // formerly-unique `lemmas_language_headword_pos_uq` is replaced
    // with a non-unique index of the same shape so the merge-candidate
    // lookup ("show me other lemmas with this headword + POS") stays
    // cheap.
    headwordIdx: index('lemmas_language_headword_pos_idx').on(
      t.language,
      t.headword,
      t.pos,
    ),
    languageIdx: index('lemmas_language_idx').on(t.language),
    frequencyIdx: index('lemmas_language_frequency_idx').on(t.language, t.frequencyRank),
    // Lookup by (language, source, source_id) is the idempotent-upsert key
    // for re-running an importer — indexed so re-imports don't full-scan.
    sourceIdx: index('lemmas_source_lookup_idx').on(t.language, t.source, t.sourceId),
  }),
);

/**
 * Known inflected forms per lemma. Populated opportunistically by the NLP
 * pipeline (a surface it successfully lemmatized) and by dictionary imports
 * that ship form tables. Used as a fallback lookup cache and as input to
 * T-6.2's "apply-to-all-instances" flow. `romanization` is precomputed at
 * write time so the script-aware input can display it instantly.
 */
export const lemmaForms = pgTable(
  'lemma_forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lemmaId: uuid('lemma_id')
      .notNull()
      .references(() => lemmas.id, { onDelete: 'cascade' }),
    surface: text('surface').notNull(),
    features: jsonb('features').$type<Record<string, string>>().notNull().default({}),
    romanization: text('romanization'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lemmaIdx: index('lemma_forms_lemma_idx').on(t.lemmaId),
    surfaceIdx: index('lemma_forms_surface_idx').on(t.surface),
  }),
);

/**
 * Translation rows for a lemma. Officials, curator edits, and user
 * submissions all live here and are distinguished by `source`. A user can
 * fork an official into a personal copy via `parent_translation_id` (T-3.5)
 * — the fork is visible only to the forker and renders at the top of the
 * pop-up for them specifically.
 *
 * `hidden` is the moderation switch for community translations; officials
 * are edited in place (with an audit trail in T-3.4's `lemma_edit_history`)
 * rather than hidden.
 */
export const translations = pgTable(
  'translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lemmaId: uuid('lemma_id')
      .notNull()
      .references(() => lemmas.id, { onDelete: 'cascade' }),
    source: translationSource('source').notNull(),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    parentTranslationId: uuid('parent_translation_id').references(
      (): AnyPgColumn => translations.id,
      { onDelete: 'set null' },
    ),
    body: text('body').notNull(),
    targetLanguage: text('target_language').notNull().default('en'),
    sourceAttribution: text('source_attribution'),
    sourceId: text('source_id'),
    hidden: boolean('hidden').notNull().default(false),
    // Curator-set display order within a translation bucket (T-3.13).
    // NULL = use the bucket's default tiebreaker (curator > imported,
    // then createdAt). When non-null, smaller ranks sort earlier within
    // the same bucket. Stored on every row even though most stay NULL —
    // a separate ordering table would force a join on every read of the
    // reader pop-up's translations payload.
    displayRank: integer('display_rank'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lemmaIdx: index('translations_lemma_idx').on(t.lemmaId),
    submittedByIdx: index('translations_submitted_by_idx').on(t.submittedBy),
    // The (lemma, source, source_id) triple is how a re-import finds its
    // own previously-written row to update.
    sourceLookupIdx: index('translations_source_lookup_idx').on(t.lemmaId, t.source, t.sourceId),
  }),
);

/**
 * Audit row per dictionary-import run. One row written per `runImport(...)`
 * invocation so we can answer "when did we last pull Hindi WordNet and
 * what changed?" without re-reading the source file or scanning lemmas.
 */
export const dictionaryImports = pgTable(
  'dictionary_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: text('source_name').notNull(),
    language: language('language').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lemmasCreated: integer('lemmas_created').notNull().default(0),
    lemmasUpdated: integer('lemmas_updated').notNull().default(0),
    lemmasSkippedCuratorLocked: integer('lemmas_skipped_curator_locked').notNull().default(0),
    translationsCreated: integer('translations_created').notNull().default(0),
    translationsUpdated: integer('translations_updated').notNull().default(0),
    notes: text('notes'),
  },
  (t) => ({
    languageIdx: index('dictionary_imports_language_idx').on(t.language, t.runAt),
  }),
);

/**
 * Per-language curator grants (T-3.4).
 *
 * A user with `role='curator'` has edit rights on a language only when a
 * row exists here. A user with `role='admin'` is treated as a curator on
 * every language without needing rows — admin is a superset. Keeping the
 * grants explicit (rather than baking language lists into `users`) means
 * add/remove is a single row write and carries its own audit columns
 * (`granted_by`, `granted_at`).
 */
export const curatorLanguages = pgTable(
  'curator_languages',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    language: language('language').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.language] }),
    userIdx: index('curator_languages_user_idx').on(t.userId),
  }),
);

/**
 * Audit log for dictionary edits (T-3.4).
 *
 * One row per curator action that mutates a lemma, its translations, or
 * its forms. `change` carries a `{ before, after }` diff so the
 * dictionary editor (T-3.7) can render "what did this curator change?"
 * and a revert control without needing a separate history table per
 * edit kind.
 *
 * `reason` is required — curators have to type something before an edit
 * commits. This is deliberately a soft "why" field, not a machine-
 * readable code, because the audit trail is for humans first.
 */
export const lemmaEditChangeType = pgEnum('lemma_edit_change_type', [
  'lemma_update',
  'lemma_unlock',
  'lemma_lock',
  'translation_insert',
  'translation_update',
  'translation_hide',
  'translation_unhide',
  'form_insert',
  'form_delete',
  // T-3.7: merge and split write to the history of *both* lemmas so the
  // timeline is complete from either side. `change` carries a full
  // snapshot of the loser (for merge) or of the translations/forms that
  // moved (for split), so a revert has enough information to reconstruct.
  'lemma_merge',
  'lemma_split',
  // T-3.13: a curator reordered the translations on a lemma. `change`
  // carries `before: {translationId, displayRank}[]` and the
  // corresponding `after` snapshot so the audit can reconstruct either
  // state.
  'translation_reorder',
]);

export const lemmaEditHistory = pgTable(
  'lemma_edit_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lemmaId: uuid('lemma_id')
      .notNull()
      .references(() => lemmas.id, { onDelete: 'cascade' }),
    editorId: uuid('editor_id').references(() => users.id, { onDelete: 'set null' }),
    changeType: lemmaEditChangeType('change_type').notNull(),
    change: jsonb('change').$type<LemmaEditChangePayload>().notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lemmaIdx: index('lemma_edit_history_lemma_idx').on(t.lemmaId, t.createdAt),
    editorIdx: index('lemma_edit_history_editor_idx').on(t.editorId),
  }),
);

/**
 * JSON shape written into `lemma_edit_history.change`. Kept as an open
 * record so merge/split (T-3.7) can store richer payloads without a
 * schema migration — the revert logic in the UI discriminates on
 * `change_type` and knows which fields to expect per type.
 *
 * Common fields:
 *   - `before` / `after`: lemma or translation snapshots for diff view.
 *   - `translationId` / `formId`: set when the edit targets a specific
 *     child row.
 *
 * Merge-specific (`change_type = 'lemma_merge'`):
 *   - `direction`: 'winner' | 'loser' (audit is written under both).
 *   - On the winner row: `mergedFrom` (loser snapshot),
 *     `translationsMoved`, `formsMoved` (full snapshots).
 *   - On the loser row: `translationIds`, `formIds` (ids only, for
 *     backlinks).
 *
 * Split-specific (`change_type = 'lemma_split'`):
 *   - `direction`: 'source' | 'created'.
 *   - On the source row: `splitInto` (snapshot of the newly created
 *     lemma), plus the moved `translationIds` / `formIds`.
 *   - On the created row: `splitFrom` (snapshot of the source lemma).
 */
export type LemmaEditChangePayload = {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  translationId?: string;
  formId?: string;
  translationIds?: string[];
  formIds?: string[];
  translationsMoved?: Array<Record<string, unknown>>;
  formsMoved?: Array<Record<string, unknown>>;
  mergedFrom?: Record<string, unknown>;
  splitInto?: Record<string, unknown>;
  splitFrom?: Record<string, unknown>;
  direction?: 'winner' | 'loser' | 'source' | 'created';
  // T-3.9 bulk-tool discriminators. The history viewer uses these to
  // group "ran one CSV" / "promoted N rows" / "rebranded an attribution"
  // into a single visible action even though each touched row writes
  // its own audit entry.
  bulkImportRow?: number;
  bulkPromote?: boolean;
  bulkAttribution?: boolean;
  // T-3.13: ordered snapshots of `(translationId, displayRank)` before
  // and after a `translation_reorder`. Stored as parallel arrays so the
  // history viewer can render either side as a list.
  translationOrderBefore?: Array<{ translationId: string; displayRank: number | null }>;
  translationOrderAfter?: Array<{ translationId: string; displayRank: number | null }>;
};

/**
 * User-imported texts (T-4.1, milestone M4).
 *
 * `source_type` records how the text was uploaded so we can show a
 * friendly badge in the library and run source-specific re-import logic
 * later (e.g. re-parsing the original EPUB after we improve chapter
 * detection). `status` is the NLP processing state — at T-4.1 every new
 * text starts `pending` and is flipped to `ready` once T-4.4 wires up
 * the worker; `failed` lets the library show a retry affordance instead
 * of a stuck spinner.
 *
 * `visibility` defaults to `private`. `shared` is granted via a row in
 * `text_shares` / `text_group_shares` (M7); `official` can only be set
 * by an admin/curator after a "make official" request and is gated on
 * licensing review (T-7.1). owner_id is nullable because official
 * curated texts are not owned by any one user.
 *
 * `text_chapters` is the natural pagination unit (EPUB chapters are
 * preserved; pasted texts default to one chapter; long .txt files are
 * auto-split at paragraph boundaries in T-4.2 / T-5.1a). The reader
 * loads one chapter at a time, so the chapter table holds the raw
 * `body` plus precomputed `token_count` for progress / library cards.
 */
export const textSourceType = pgEnum('text_source_type', [
  'paste',
  'txt',
  'epub',
]);

export const textStatus = pgEnum('text_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

export const textVisibility = pgEnum('text_visibility', [
  'private',
  'shared',
  'official',
]);

export const texts = pgTable(
  'texts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable so curated/official texts can exist without a user owning
    // them. The auth helper in T-4.6 (`assertCanRead`) treats a null
    // owner_id as "publicly readable iff visibility='official'."
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    language: language('language').notNull(),
    title: text('title').notNull(),
    sourceType: textSourceType('source_type').notNull(),
    status: textStatus('status').notNull().default('pending'),
    visibility: textVisibility('visibility').notNull().default('private'),
    statusError: text('status_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Library "your texts" tab needs a fast scan over the user's own
    // imports ordered by recency.
    ownerIdx: index('texts_owner_idx').on(t.ownerId, t.createdAt),
    // Public official-library page needs a fast scan over (visibility,
    // language) — see T-4.5.
    visibilityIdx: index('texts_visibility_idx').on(t.visibility, t.language),
  }),
);

/**
 * Per-recipient text shares (T-7.2).
 *
 * The owner of a text can grant individual readers explicit access
 * even when the text's visibility is 'private'. canReadText (T-4.6)
 * extends to allow any (text_id, viewer.id) pair that has a row
 * here. Group shares (T-7.4) live in a sibling `text_group_shares`
 * table; the two are independent so a curator can share with a
 * group AND specific extra individuals without juggling membership.
 *
 * Permission column reserved for future read/write distinctions —
 * MVP only models 'read'.
 */
export const textSharePermission = pgEnum('text_share_permission', ['read']);

export const textShares = pgTable(
  'text_shares',
  {
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    sharedWithUserId: uuid('shared_with_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: textSharePermission('permission').notNull().default('read'),
    grantedById: uuid('granted_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.textId, t.sharedWithUserId] }),
    // "What's shared with me?" lookup for the T-7.5 inbox.
    recipientIdx: index('text_shares_recipient_idx').on(t.sharedWithUserId),
  }),
);

/**
 * User groups (T-7.3) — classroom rosters, study clubs, etc.
 *
 * `owner_id` is the group's admin (creator + manager). M7 keeps
 * groups simple: no role hierarchy beyond owner / member, no
 * invitations workflow (the owner adds members directly by email
 * resolution). T-7.8's classroom dashboard surfaces aggregate stats
 * for the owner.
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index('groups_owner_idx').on(t.ownerId, t.createdAt),
  }),
);

export const groupMemberships = pgTable(
  'group_memberships',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedById: uuid('added_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.userId] }),
    userIdx: index('group_memberships_user_idx').on(t.userId),
  }),
);

/**
 * Per-group text shares (T-7.4). Sibling of `text_shares` —
 * granting at the group level extends read access to every
 * member of the group at the time canReadText runs (memberships
 * checked dynamically so adds / removes take effect immediately).
 */
export const textGroupShares = pgTable(
  'text_group_shares',
  {
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    grantedById: uuid('granted_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.textId, t.groupId] }),
    groupIdx: index('text_group_shares_group_idx').on(t.groupId),
  }),
);

export const textChapters = pgTable(
  'text_chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    title: text('title'),
    body: text('body').notNull(),
    // Cheap precompute on insert. The reader's library cards and
    // progress bars need it; computing it on read is wasteful.
    tokenCount: integer('token_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    textOrderUq: unique('text_chapters_text_idx_uq').on(t.textId, t.idx),
    textIdx: index('text_chapters_text_idx').on(t.textId, t.idx),
  }),
);

export type User = InferSelectModel<typeof users>;
export type Session = InferSelectModel<typeof sessions>;
export type RefreshToken = InferSelectModel<typeof refreshTokens>;
export type MagicLink = InferSelectModel<typeof magicLinks>;
export type UserLanguage = InferSelectModel<typeof userLanguages>;
export type Lemma = InferSelectModel<typeof lemmas>;
export type LemmaForm = InferSelectModel<typeof lemmaForms>;
export type Translation = InferSelectModel<typeof translations>;
export type DictionaryImport = InferSelectModel<typeof dictionaryImports>;
export type CuratorLanguage = InferSelectModel<typeof curatorLanguages>;
export type LemmaEditHistoryEntry = InferSelectModel<typeof lemmaEditHistory>;
/**
 * NLP job bookkeeping (T-4.4).
 *
 * One row per "process this text" job. Inserted by the upload service
 * right after the `texts` row + chapters land; the NLP worker (T-2.6)
 * consumes from a Redis queue and writes back to this table when it
 * picks the job up, finishes successfully, or hits an error.
 *
 * Why a separate table from `texts.status`:
 *  - A text can be re-processed (T-6.8 admin re-run) without dropping
 *    the original audit trail; a new `nlp_jobs` row records the
 *    second run while the previous one stays in history.
 *  - Errors are captured per-job, not per-text — useful when the
 *    second attempt succeeds.
 *  - The web UI's status badge reads from `texts.status`; this table
 *    drives admin/monitoring views.
 */
export const nlpJobStatus = pgEnum('nlp_job_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const nlpJobs = pgTable(
  'nlp_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    status: nlpJobStatus('status').notNull().default('pending'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    textIdx: index('nlp_jobs_text_idx').on(t.textId, t.createdAt),
    statusIdx: index('nlp_jobs_status_idx').on(t.status),
  }),
);

/**
 * Per-token output from the NLP worker (T-2.6 / T-5.2).
 *
 * One row per surface token in a chapter, in reading order. The
 * reader joins this against `user_known_lemmas` to colour known /
 * learning / unknown words. Tokens without a `lemma_id` are
 * punctuation, whitespace, or unresolved OOV — they render as plain
 * text without the pop-up.
 *
 * `lemma_candidates` stores the top-K candidate list the pipeline
 * returned (T-2.2's contract); `is_ambiguous` is set when 2nd-place
 * is within the confidence threshold of the top. M6's
 * disambiguation UX reads both.
 */
export const textTokens = pgTable(
  'text_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => textChapters.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    surface: text('surface').notNull(),
    lemmaId: uuid('lemma_id').references(() => lemmas.id, {
      onDelete: 'set null',
    }),
    lemmaCandidates: jsonb('lemma_candidates')
      .$type<
        Array<{
          lemmaId: string | null;
          features: Record<string, string>;
          score: number;
        }>
      >()
      .notNull()
      .default([]),
    features: jsonb('features')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    isAmbiguous: boolean('is_ambiguous').notNull().default(false),
    isOov: boolean('is_oov').notNull().default(false),
    isWord: boolean('is_word').notNull().default(true),
    sentenceIdx: integer('sentence_idx').notNull().default(0),
    romanization: text('romanization'),
  },
  (t) => ({
    chapterIdx: unique('text_tokens_chapter_idx_uq').on(t.chapterId, t.idx),
    chapterScan: index('text_tokens_chapter_scan_idx').on(t.chapterId, t.idx),
    lemmaIdx: index('text_tokens_lemma_idx').on(t.lemmaId),
  }),
);

/**
 * Per-user known-words ledger (T-5.2).
 *
 * Status:
 *  - 'unknown'  — never marked. The default for any lemma the user
 *                 hasn't touched. Stored explicitly only when we want
 *                 a row (e.g. for an audit / "I deliberately don't
 *                 know this"); usually represented by absence.
 *  - 'learning' — actively encountering, want to study. Highlight
 *                 prominently in the reader.
 *  - 'known'    — confidently knows. Don't highlight. Counts toward
 *                 the user's known-words stat per language.
 *  - 'ignored'  — proper nouns / borrowings the user doesn't want to
 *                 study. Don't highlight, don't count.
 */
export const knownLemmaStatus = pgEnum('known_lemma_status', [
  'unknown',
  'learning',
  'known',
  'ignored',
]);

export const userKnownLemmas = pgTable(
  'user_known_lemmas',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lemmaId: uuid('lemma_id')
      .notNull()
      .references(() => lemmas.id, { onDelete: 'cascade' }),
    status: knownLemmaStatus('status').notNull().default('learning'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.lemmaId] }),
    userIdx: index('user_known_lemmas_user_idx').on(t.userId, t.status),
  }),
);

/**
 * Per-user reading progress (T-5.6).
 *
 * One row per (user, text). The reader writes this debounced as the
 * user scrolls / paginates so the library card can show "Page 4 of
 * 12 — 30% read" and the next reader visit can resume at the
 * anchor. Composite PK matches the natural identity.
 */
export const userTextProgress = pgTable(
  'user_text_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    lastChapterIdx: integer('last_chapter_idx').notNull().default(0),
    lastTokenIdx: integer('last_token_idx').notNull().default(0),
    pctRead: real('pct_read').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.textId] }),
    userIdx: index('user_text_progress_user_idx').on(t.userId, t.updatedAt),
  }),
);

/**
 * Form → lemma override map (T-2.7).
 *
 * The NLP worker's lemmatizer guesses a lemma per token. When the
 * guess is wrong (e.g. Stanza's Hindi UD model lemmatizes ``है`` to
 * itself instead of ``होना``), we override it from this table:
 * the dispatcher pre-loads every override for the language at
 * processing time and prefers the table's pick over Stanza's
 * candidate.
 *
 * Two sources of rows:
 *
 * 1. Curator seed — high-impact treebank quirks the team hand-fixes
 *    once and ships in a migration / seed script.
 * 2. Crowdsourced (T-6.7) — the aggregation worker promotes
 *    `token_corrections` to this table when ≥K distinct users have
 *    made the same correction on a matching `(surface, context)`.
 *
 * `context_signature` is a sha1-16 hash of `(prev_pos, cur_pos,
 * next_pos)` matching the worker's helper in
 * services/nlp/app/worker/overrides.py — so the override is
 * applied only when the surface appears in a similar POS context,
 * preventing a homograph fix from over-applying. The empty-string
 * value `''` is a wildcard match that ignores context — used for
 * curator seeds where the surface is unambiguous regardless of
 * context (the copula seeds are this case).
 *
 * Each row tracks `vote_count` (how many user corrections aggregated
 * into it) + `promoted_at` / `promoted_by` for the audit trail.
 */
export const formLemmaOverrides = pgTable(
  'form_lemma_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    language: language('language').notNull(),
    surfaceNfc: text('surface_nfc').notNull(),
    contextSignature: text('context_signature').notNull().default(''),
    chosenLemmaId: uuid('chosen_lemma_id')
      .notNull()
      .references(() => lemmas.id, { onDelete: 'cascade' }),
    voteCount: integer('vote_count').notNull().default(1),
    promotedAt: timestamp('promoted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    promotedBy: uuid('promoted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
  },
  (t) => ({
    uniqOnTriple: unique('form_lemma_overrides_lang_surface_ctx_uq').on(
      t.language,
      t.surfaceNfc,
      t.contextSignature,
    ),
    // Hot lookup: the worker / dispatcher hits this for every word
    // in every chapter of every text being processed.
    lookupIdx: index('form_lemma_overrides_lookup_idx').on(
      t.language,
      t.surfaceNfc,
    ),
  }),
);

/**
 * Per-user lemma corrections on a specific token (T-6.1 + onwards).
 *
 * The reader's WordPopup shows the NLP worker's top guess; when the
 * user knows it's wrong they can:
 *
 *  - pick_candidate     — select one of the top-K lemma_candidates
 *                         the worker returned (T-6.1 — the cheapest
 *                         flow; data already on-row).
 *  - manual_lemma       — search the dictionary and pick a lemma
 *                         that wasn't in the candidate list (T-6.2).
 *  - new_lemma          — propose a new lemma that doesn't exist
 *                         yet (T-6.3 — also creates a lemma_proposal).
 *  - mark_proper_noun / — soft "this surface isn't a learnable word"
 *    mark_foreign /       flags. They suppress the OOV / unknown
 *    mark_not_a_word      colouring without surfacing a lemma at all.
 *
 * Primary-keyed on (user, token) so re-correcting overwrites — a
 * user changes their mind, the reader reflects the new pick. The
 * crowdsourced aggregation worker (T-6.7) reads this table to
 * promote consensus picks into `form_lemma_overrides`.
 */
export const tokenCorrectionType = pgEnum('token_correction_type', [
  'pick_candidate',
  'manual_lemma',
  'new_lemma',
  'mark_proper_noun',
  'mark_foreign',
  'mark_not_a_word',
]);

export const tokenCorrections = pgTable(
  'token_corrections',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => textTokens.id, { onDelete: 'cascade' }),
    type: tokenCorrectionType('type').notNull(),
    // Set for `pick_candidate` / `manual_lemma`. NULL for the
    // mark_* and new_lemma branches (new_lemma also writes a
    // lemma_proposals row that carries the proposed entry —
    // landing in T-6.3). On lemma deletion the row is kept (set
    // null) so the audit trail isn't lost; the reader treats a
    // null chosen_lemma_id like any other absent correction.
    chosenLemmaId: uuid('chosen_lemma_id').references(() => lemmas.id, {
      onDelete: 'set null',
    }),
    // Free-form reporter note. Optional today; T-6.5 surfaces it on
    // the moderation dashboard.
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tokenId] }),
    tokenIdx: index('token_corrections_token_idx').on(t.tokenId),
    // Aggregation worker (T-6.7) groups by (lemma, type) — index
    // matches that lookup so the cron stays cheap.
    lemmaIdx: index('token_corrections_chosen_lemma_idx').on(
      t.chosenLemmaId,
      t.type,
    ),
  }),
);

/**
 * User-submitted new-lemma proposals (T-6.3).
 *
 * When the correction modal's dictionary search comes up empty, the
 * user can propose a new lemma via the new-lemma form. We don't
 * write directly to `lemmas` — that table is the curator-validated
 * dictionary and bulk-imports / promotions go through the
 * dictionary editor — but the proposer needs to see the entry
 * immediately on the page they're reading. So we:
 *
 *   1. Insert a `lemma_proposals` row with status='pending'.
 *   2. Insert a `token_corrections` row (type=new_lemma, chosen_lemma_id=null).
 *   3. File a `parse_reports` row so the curator dashboard surfaces it.
 *
 * Curator acceptance in T-6.6 copies the proposal into `lemmas` and
 * back-fills `token_corrections.chosen_lemma_id` on every row that
 * was created against this proposal. Rejection just flips the
 * proposal status — the user's per-token correction stays as a
 * 'new_lemma' marker so the surface remains uncoloured.
 */
export const lemmaProposalStatus = pgEnum('lemma_proposal_status', [
  'pending',
  'accepted',
  'rejected',
]);

export const lemmaProposals = pgTable(
  'lemma_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposerId: uuid('proposer_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    language: language('language').notNull(),
    headword: text('headword').notNull(),
    pos: text('pos').notNull(),
    glossDefault: text('gloss_default'),
    notes: text('notes'),
    status: lemmaProposalStatus('status').notNull().default('pending'),
    // When the curator accepts a proposal we copy it into `lemmas`
    // and link the resulting lemma id here so the audit trail is
    // legible from either side.
    promotedLemmaId: uuid('promoted_lemma_id').references(() => lemmas.id, {
      onDelete: 'set null',
    }),
    reviewerId: uuid('reviewer_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewerNote: text('reviewer_note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index('lemma_proposals_lang_status_idx').on(t.language, t.status),
    headwordIdx: index('lemma_proposals_headword_idx').on(
      t.language,
      t.headword,
      t.pos,
    ),
  }),
);

/**
 * Curator moderation queue for parse / lemma errors (T-6.5).
 *
 * Distinct from `token_corrections`: corrections are *per-user*
 * picks the reader applies to their own view. A `parse_report` is
 * a *site-wide* claim that the worker (or the dictionary) is
 * mis-modeling a specific surface — surfaced to curators on T-6.6's
 * moderation page, who promote accepted reports to
 * `form_lemma_overrides` (the global override table) and/or fix
 * the dictionary itself.
 *
 * Two routes file rows here:
 *
 *  - User-initiated: T-6.2's correction modal optionally checks
 *    "Also report to moderators" when the user picks a manual
 *    lemma / proposes a new one. (Default OFF for `pick_candidate`,
 *    ON for `manual_lemma` / `new_lemma`.)
 *
 *  - System-initiated: T-6.7's aggregation worker auto-files a
 *    `triaged`-status report when ≥K users converge on the same
 *    correction. The curator's choice in T-6.6 promotes or vetoes.
 *
 * Duplicate merging: a new report whose
 * `(language, surface_nfc, context_signature, corrected_lemma_id)`
 * matches an existing open / triaged row increments that row's
 * `duplicate_count` instead of creating a new row. Resolved /
 * rejected rows do NOT collide — re-files after a curator
 * resolution start a new conversation.
 */
export const parseReportStatus = pgEnum('parse_report_status', [
  'open',
  'triaged',
  'resolved',
  'rejected',
  'duplicate',
  'deferred',
]);

export const parseReports = pgTable(
  'parse_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: uuid('token_id').references(() => textTokens.id, {
      onDelete: 'set null',
    }),
    language: language('language').notNull(),
    surfaceNfc: text('surface_nfc').notNull(),
    // sha1-16 of (prev_pos, cur_pos, next_pos) — same shape as
    // form_lemma_overrides.context_signature so the dedup math
    // matches what T-6.7's aggregation worker writes downstream.
    contextSignature: text('context_signature').notNull().default(''),
    // Snapshot of the worker's top-K candidate list at report time —
    // useful for the moderation UI even when the underlying token
    // has since been re-processed.
    originalCandidates: jsonb('original_candidates')
      .$type<
        Array<{
          lemmaId: string | null;
          score: number;
          features: Record<string, string>;
        }>
      >()
      .notNull()
      .default([]),
    correctedLemmaId: uuid('corrected_lemma_id').references(() => lemmas.id, {
      onDelete: 'set null',
    }),
    correctionType: tokenCorrectionType('correction_type').notNull(),
    reporterId: uuid('reporter_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    status: parseReportStatus('status').notNull().default('open'),
    assignedReviewerId: uuid('assigned_reviewer_id').references(
      () => users.id,
      {
        onDelete: 'set null',
      },
    ),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    duplicateCount: integer('duplicate_count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    languageStatusIdx: index('parse_reports_lang_status_idx').on(
      t.language,
      t.status,
    ),
    dedupIdx: index('parse_reports_dedup_idx').on(
      t.language,
      t.surfaceNfc,
      t.contextSignature,
      t.correctedLemmaId,
    ),
  }),
);

export type Text = InferSelectModel<typeof texts>;
export type TextChapter = InferSelectModel<typeof textChapters>;
export type NlpJob = InferSelectModel<typeof nlpJobs>;
export type TextToken = InferSelectModel<typeof textTokens>;
export type UserKnownLemma = InferSelectModel<typeof userKnownLemmas>;
export type UserTextProgress = InferSelectModel<typeof userTextProgress>;
export type FormLemmaOverride = InferSelectModel<typeof formLemmaOverrides>;
export type TokenCorrection = InferSelectModel<typeof tokenCorrections>;
export type ParseReport = InferSelectModel<typeof parseReports>;
export type LemmaProposal = InferSelectModel<typeof lemmaProposals>;
export type TextShare = InferSelectModel<typeof textShares>;
export type Group = InferSelectModel<typeof groups>;
export type GroupMembership = InferSelectModel<typeof groupMemberships>;
export type TextGroupShare = InferSelectModel<typeof textGroupShares>;
