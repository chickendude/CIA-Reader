import {
  type AnyPgColumn,
  boolean,
  bigint,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql, type InferSelectModel } from 'drizzle-orm';

export const userRole = pgEnum('user_role', ['user', 'curator', 'admin']);
export const themePreference = pgEnum('theme_preference', ['system', 'light', 'dark']);

// MVP languages. Kept in sync with @ciareader/shared-types' LanguageCode;
// adding a new language means extending both sides in lockstep. The registry
// is the human-facing source of truth, but Postgres needs its own enum so
// FK-like integrity is enforced at the DB layer.
export const language = pgEnum('language', ['hi', 'mr', 'or', 'yi', 'eu']);

// Romanization schemes a user can pick. Subset of the registry's
// RomanizationScheme — the DB only needs to store choices users can make.
export const romanizationScheme = pgEnum('romanization_scheme', [
  'iso15919',
  'iast',
  'hunterian',
  'itrans',
  'yivo',
]);

// What the learner wants rendered in the reader: pure native script, script
// with inline romanization above each word, or romanization-only (training
// wheels for brand-new readers). Defaults to 'native'.
export const scriptPreference = pgEnum('script_preference', [
  'native',
  'native_with_romanization',
  'romanization_only',
]);

// Save layout per language so a
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
  'none',
]);

/** Save column width per language so the reader can choose what feels comfortable for each script. */
export const readingWidth = pgEnum('reading_width', [
  'narrow',
  'medium',
  'wide',
]);

/** The starting level the reader chose for this language during onboarding. */
export const languageBaseline = pgEnum('language_baseline', [
  'none',
  'beginner',
  'intermediate',
]);

// Origin tag on a `lemma_forms` row. Drives regenerate semantics:
// `curator` rows survive a paradigm regenerate, the others do not.
export const lemmaFormSource = pgEnum('lemma_form_source', [
  'import',
  'pipeline',
  'curator',
  'generator',
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

export const personalApiKeys = pgTable(
  'personal_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashUnique: unique('personal_api_keys_hash_unique').on(t.keyHash),
    userIdx: index('personal_api_keys_user_idx').on(t.userId),
    activeUserIdx: uniqueIndex('personal_api_keys_one_active_per_user').on(t.userId).where(sql`${t.revokedAt} IS NULL`),
  }),
);

/**
 * Rolling-window API rate limit events. The subject hash is derived from the
 * personal API key secret, per-device id, or user id; raw tokens/device ids are
 * never stored.
 */
export const apiRateLimitEvents = pgTable(
  'api_rate_limit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectHash: text('subject_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectWindowIdx: index('api_rate_limit_events_subject_window_idx').on(
      t.scope,
      t.subjectType,
      t.subjectHash,
      t.createdAt,
    ),
    userIdx: index('api_rate_limit_events_user_idx').on(t.userId),
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
 * Reading preferences belong to each user and language. Keeping a count of known words here saves
 * the stats page from counting every entry on each visit.
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
    knownPhrasesCountCache: integer('known_phrases_count_cache').notNull().default(0),
    readerLayoutMode: readerLayoutMode('reader_layout_mode').notNull().default('page'),
    wordsPerPage: integer('words_per_page').notNull().default(250),
    fontFamily: text('font_family'),
    fontSize: real('font_size').notNull().default(18),
    lineSpacing: real('line_spacing').notNull().default(1.6),
    highlightStyle: highlightStyle('highlight_style').notNull().default('background'),
    highlightLearning: boolean('highlight_learning').notNull().default(true),
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
  // Phrases found by the parser receive this source after they appear in enough distinct
  // chapters.
  'nlp',
]);

export const translationVoteValue = pgEnum('translation_vote_value', [
  'up',
  'down',
]);

/**
 * A translation can belong to a word or a phrase. The target type determines which table holds
 * the ID, so the application checks that the target exists.
 */
export const translationTargetType = pgEnum('translation_target_type', [
  'lemma',
  'phrase',
]);

/**
 * Different sources may give the same word different entries. Keep their attribution, and skip
 * curator-locked entries during import.
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
    // Keep this search key in sync with stripNukta. It removes Devanagari nukta marks and folds
    // equivalent Yiddish spellings. Postgres stores the result so fallback searches can use an
    // index.
    headwordNuktaStripped: text('headword_nukta_stripped')
      .notNull()
      .generatedAlwaysAs(
        sql`replace(replace(replace(replace(translate(normalize("headword", NFD), '़', ''), 'װ', 'וו'), 'ױ', 'וי'), 'ײ', 'יי'), 'יַי', 'ייַ')`,
      ),
    // A lemma may opt into a paradigm (e.g. "Odia regular verb"). When set,
    // the form-editor's "regenerate forms" action wipes generator-created
    // and import-created form rows for this lemma and re-derives them from
    // the paradigm's slot suffixes appended to `stem`. Curator-edited
    // forms survive regenerate. Both columns are nullable: a lemma with
    // no paradigm assignment is the default and behaves exactly as before.
    paradigmId: uuid('paradigm_id').references((): AnyPgColumn => paradigms.id, {
      onDelete: 'set null',
    }),
    stem: text('stem'),
  },
  (t) => ({
    // Preserve each source's entry even when two dictionaries give the same headword and part of
    // speech.
    headwordIdx: index('lemmas_language_headword_pos_idx').on(
      t.language,
      t.headword,
      t.pos,
    ),
    spellingIdx: index('lemmas_language_spelling_idx').on(t.language, sql`lower(normalize(${t.headword}))`),
    languageIdx: index('lemmas_language_idx').on(t.language),
    frequencyIdx: index('lemmas_language_frequency_idx').on(t.language, t.frequencyRank),
    // Lookup by (language, source, source_id) is the idempotent-upsert key
    // for re-running an importer — indexed so re-imports don't full-scan.
    sourceIdx: index('lemmas_source_lookup_idx').on(t.language, t.source, t.sourceId),
    headwordStrippedIdx: index('lemmas_language_headword_stripped_idx').on(
      t.language,
      t.headwordNuktaStripped,
    ),
  }),
);

/**
 * Recorded word forms connect an inflected spelling to its dictionary entry and help find other
 * occurrences of a correction.
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
    // Provenance of this row. Affects regenerate behaviour: only
    // `curator` rows survive a paradigm regenerate. All pre-existing
    // rows are backfilled to `'import'` in the same migration that
    // adds the column.
    createdBy: lemmaFormSource('created_by').notNull().default('import'),
    // When the row was generated from a paradigm slot, points at the
    // slot it came from. NULL for rows whose `created_by` ≠ 'generator'
    // (or for legacy generator rows pre-dating this column). FK is
    // SET NULL on delete so removing a slot orphans the rows rather
    // than wiping curator-relevant data.
    paradigmSlotId: uuid('paradigm_slot_id').references(
      (): AnyPgColumn => paradigmSlots.id,
      { onDelete: 'set null' },
    ),
    // Quarantine flags. Junk imports (Wiktionary template names like
    // `hi-ndecl`, IAST that should have been in `romanization`, etc.)
    // are flagged here in a one-shot migration. The dispatcher's
    // surface-lookup tier filters `WHERE quarantined_at IS NULL` so
    // quarantined rows can't poison resolution. A future admin page
    // will let curators review, salvage, or hard-delete the queue.
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
    quarantineReason: text('quarantine_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lemmaIdx: index('lemma_forms_lemma_idx').on(t.lemmaId),
    spellingIdx: index('lemma_forms_spelling_idx')
      .on(sql`lower(normalize(${t.surface}))`).where(sql`quarantined_at IS NULL`),
    surfaceIdx: index('lemma_forms_surface_idx').on(t.surface),
    // Hot-path index for the dispatcher's surface→lemma resolution.
    // Filtered (`WHERE quarantined_at IS NULL`) so the index is small
    // and the dispatcher's query reads only live rows.
    surfaceLookupIdx: index('lemma_forms_surface_lookup_idx')
      .on(t.surface, t.lemmaId)
      .where(sql`quarantined_at IS NULL`),
  }),
);

/**
 * A conjugation/declension pattern. A lemma opts in by setting its
 * `paradigm_id` + `stem`; the form-editor's regenerate action then
 * derives form rows from this paradigm's slots (`paradigm_slots`).
 *
 * Scoped per (language, pos): an "Odia regular verb" paradigm only
 * applies to Odia VERBs. The editor filters its paradigm picker by
 * the lemma's language + pos so curators don't see irrelevant rows.
 */
export const paradigms = pgTable(
  'paradigms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    language: language('language').notNull(),
    pos: text('pos').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    languagePosIdx: index('paradigms_language_pos_idx').on(t.language, t.pos),
    languagePosNameUq: unique('paradigms_language_pos_name_uq').on(
      t.language,
      t.pos,
      t.name,
    ),
  }),
);

/**
 * One cell in a paradigm. Each slot defines:
 *  - `slot_key`: a stable handle ("pres_hab_1sg", "inf"), unique per
 *    paradigm. Used by tests + the editor to address a slot without
 *    its UUID.
 *  - `features`: UD-shaped morphology emitted onto the generated
 *    `lemma_forms.features` blob. The grammar_features table
 *    translates these to the popup's pill labels.
 *  - `suffix`: appended to the lemma's `stem` to produce the surface
 *    form. Sandhi (vowel joins like ରହ+ଉଛି→ରହୁଛି) is handled by a
 *    per-language combine() helper in the generator, not by encoding
 *    sandhi rules into the suffix.
 *  - `sort_order`: drives the editor's display ordering — slots
 *    grouped by `features.Tense` then ordered by `sort_order`.
 */
export const paradigmSlots = pgTable(
  'paradigm_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paradigmId: uuid('paradigm_id')
      .notNull()
      .references(() => paradigms.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key').notNull(),
    features: jsonb('features').$type<Record<string, string>>().notNull().default({}),
    suffix: text('suffix').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    paradigmIdx: index('paradigm_slots_paradigm_idx').on(t.paradigmId),
    paradigmKeyUq: unique('paradigm_slots_paradigm_key_uq').on(
      t.paradigmId,
      t.slotKey,
    ),
  }),
);

/**
 * Lookup table that turns raw UD feature key/value pairs into the
 * compact + long labels the popup renders ("past" hover→"past tense").
 *
 * Seeded once via migration; the dispatcher / popup don't write to
 * this table at runtime. `pos_scope` filters which POSes the row
 * applies to — Tense=Past tags `[VERB]`, Number=Sing tags
 * `[NOUN, ADJ, VERB, PRON]`, etc. NULL/empty array means "all POSes"
 * (we use the array-not-null + may-be-empty convention; the lookup
 * helper treats empty as universal).
 */
export const grammarFeatures = pgTable(
  'grammar_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    featKey: text('feat_key').notNull(),
    featValue: text('feat_value').notNull(),
    posScope: text('pos_scope').array().notNull().default(sql`ARRAY[]::text[]`),
    shortLabel: text('short_label').notNull(),
    longLabel: text('long_label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    keyValueUq: unique('grammar_features_key_value_uq').on(
      t.featKey,
      t.featValue,
    ),
    keyIdx: index('grammar_features_key_idx').on(t.featKey),
  }),
);

/**
 * Entries from different sources can share a phrase spelling. Keep them separate until a curator
 * merges them.
 */
export const phrases = pgTable(
  'phrases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    language: language('language').notNull(),
    // NFC-normalised, single-spaced join of `phrase_tokens.surface`
    // ordered by `position`. Dedup lookup only — the canonical key
    // is the ordered phrase_tokens rows.
    surfaceNormalised: text('surface_normalised').notNull(),
    pos: text('pos'),
    glossDefault: text('gloss_default'),
    frequencyRank: integer('frequency_rank'),
    source: translationSource('source').notNull(),
    sourceAttribution: text('source_attribution'),
    sourceId: text('source_id'),
    curatorLocked: boolean('curator_locked').notNull().default(false),
    // moderation flag mirroring the lemma-side translation
    // hidden bit. A `hidden` phrase is invisible to anonymous and
    // user-role viewers but still visible to curators / admins so
    // they can review and unhide. Used both for spam mitigation
    // and for taking down NLP-promoted phrases that turn out to
    // be noise.
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    surfaceIdx: index('phrases_language_surface_idx').on(t.language, t.surfaceNormalised),
    languageIdx: index('phrases_language_idx').on(t.language),
    frequencyIdx: index('phrases_language_frequency_idx').on(t.language, t.frequencyRank),
    // Idempotent re-import: an importer finds its own previously-
    // written row by (language, source, source_id).
    sourceIdx: index('phrases_source_lookup_idx').on(t.language, t.source, t.sourceId),
  }),
);

/**
 * Ordered token components of a phrase. The canonical
 * identity of a phrase is the ordered `(surface)` rows here — the
 * `phrases.surface_normalised` column is just a fast dedupe lookup.
 *
 * `lemma_id` is a *soft hint*, not a join key — `इंतज़ार करना` ≠
 * `इंतज़ार` + `करना` semantically. Cross-linking to a lemma drives
 * the popup's "see component lemmas" affordance and lets the
 * frequency-rank scorer inherit data, but it never participates in
 * matching. Set to NULL on lemma deletion so cascading lemma merges
 * never silently rewrite phrase identity.
 */
export const phraseTokens = pgTable(
  'phrase_tokens',
  {
    phraseId: uuid('phrase_id')
      .notNull()
      .references(() => phrases.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    surface: text('surface').notNull(),
    lemmaId: uuid('lemma_id').references(() => lemmas.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.phraseId, t.position] }),
    // Find candidate phrases by their first word before comparing the rest.
    surfaceIdx: index('phrase_tokens_surface_idx').on(t.surface),
  }),
);

/**
 * A translation belongs to either a word or a phrase. A personal copy keeps a link to its
 * original so the reader can see where it came from.
 */
export const translations = pgTable(
  'translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: translationTargetType('target_type').notNull().default('lemma'),
    targetId: uuid('target_id').notNull(),
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
    // Per-note privacy: a private user note is visible only to its author —
    // excluded from other viewers' community bucket, from moderation/export,
    // and from the submission rate-limit count. Officials/curator rows are
    // never private. Defaults false so existing rows stay public.
    isPrivate: boolean('is_private').notNull().default(false),
    // Curator-set display order within a translation bucket.
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
    targetIdx: index('translations_target_idx').on(t.targetType, t.targetId, t.source),
    submittedByIdx: index('translations_submitted_by_idx').on(t.submittedBy),
    // Identify each imported translation by its target and original source record so repeated
    // imports update the same row.
    sourceLookupIdx: index('translations_source_lookup_idx').on(
      t.targetType,
      t.targetId,
      t.source,
      t.sourceId,
    ),
  }),
);

/**
 * Per-user votes on community translations.
 *
 * Official and curator translations are not reordered by votes; this table is
 * read only for `source='user'` rows in the community bucket. One user gets one
 * current vote per translation, and clearing a vote deletes the row.
 */
export const translationVotes = pgTable(
  'translation_votes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    translationId: uuid('translation_id')
      .notNull()
      .references(() => translations.id, { onDelete: 'cascade' }),
    value: translationVoteValue('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.translationId] }),
    translationIdx: index('translation_votes_translation_idx').on(
      t.translationId,
    ),
    userIdx: index('translation_votes_user_idx').on(t.userId),
  }),
);

/**
 * Readers can report a community translation once each. Hiding or keeping it resolves the open
 * reports for that translation. Dismissing a single report leaves the others open.
 */
export const translationReportReason = pgEnum('translation_report_reason', [
  'spam',
  'incorrect',
  'offensive',
  'duplicate',
  'other',
]);

export const translationReportStatus = pgEnum('translation_report_status', [
  'open',
  'resolved_hidden',
  'resolved_kept',
  'dismissed',
]);

export const translationReports = pgTable(
  'translation_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    translationId: uuid('translation_id')
      .notNull()
      .references(() => translations.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: translationReportReason('reason').notNull(),
    note: text('note'),
    status: translationReportStatus('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('translation_reports_status_idx').on(t.status, t.createdAt),
    translationIdx: index('translation_reports_translation_idx').on(t.translationId),
    reporterTranslationUq: unique('translation_reports_reporter_translation_uq').on(
      t.reporterId,
      t.translationId,
    ),
  }),
);

/**
 * Record each import's source, result and initiating user so an admin can see when it ran and why
 * it failed.
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
    triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('succeeded'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    languageIdx: index('dictionary_imports_language_idx').on(t.language, t.runAt),
    sourceLatestIdx: index('dictionary_imports_source_latest_idx').on(t.sourceName, t.runAt),
  }),
);

/**
 * Global, server-side cache for the admin-only Basque reference lookups
 * (Elhuyar / Euskaltzaindia). These are proprietary sources we never write
 * to `translations` and never serve to readers — this table only spares the
 * upstream sites from repeated hits. Not tied to a user: one row per
 * (word, source), refreshed when older than the lookup TTL. The admin
 * reference endpoint is the only reader/writer; see
 * `$lib/server/dictionary/basque-reference-cache.ts`.
 */
export const basqueReferenceCache = pgTable(
  'basque_reference_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lowercased lookup word (the resolved lemma). */
    word: text('word').notNull(),
    /** Upstream source: 'elhuyar_es' | 'elhuyar_en' | 'euskaltzaindia'. */
    source: text('source').notNull(),
    /** Parsed results for this (word, source); shape mirrors
     *  `BasqueReferenceResult` in basque-reference.ts. */
    results: jsonb('results')
      .$type<
        Array<{
          source: string;
          label: string;
          headword: string;
          pos: string;
          definition: string;
          examples: string[];
          url: string;
        }>
      >()
      .notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wordSource: unique('basque_reference_cache_word_source_uq').on(t.word, t.source),
  }),
);

/**
 * Cache of OpenAI sentence translations, keyed by (source language, target
 * language, model, sentence hash). Global (not per-user) so a sentence is
 * translated once regardless of who hits it; keeps gpt-4o cost + latency down.
 */
export const sentenceTranslations = pgTable(
  'sentence_translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Source language code. */
    language: text('language').notNull(),
    targetLanguage: text('target_language').notNull(),
    /** OpenAI model used (cache invalidates implicitly when the model changes). */
    model: text('model').notNull(),
    /** sha256 of the source sentence. */
    textHash: text('text_hash').notNull(),
    text: text('text').notNull(),
    translation: text('translation').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    key: unique('sentence_translations_key_uq').on(
      t.language,
      t.targetLanguage,
      t.model,
      t.textHash,
    ),
  }),
);

/**
 * Per-language curator grants.
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
 * Audit log for dictionary edits.
 *
 * One row per curator action that mutates a lemma, its translations, or
 * its forms. `change` carries a `{ before, after }` diff so the
 * dictionary editor can render "what did this curator change?"
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
  // merge and split write to the history of *both* lemmas so the
  // timeline is complete from either side. `change` carries a full
  // snapshot of the loser (for merge) or of the translations/forms that
  // moved (for split), so a revert has enough information to reconstruct.
  'lemma_merge',
  'lemma_split',
  // a curator reordered the translations on a lemma. `change`
  // carries `before: {translationId, displayRank}[]` and the
  // corresponding `after` snapshot so the audit can reconstruct either
  // state.
  'translation_reorder',
  // Phrase-side audit rows ride on the same table, the
  // `lemma_edit_history` row gets `phrase_id` set instead of
  // `lemma_id`. Rationale in the table comment below.
  'phrase_update',
  'phrase_lock',
  'phrase_unlock',
  'phrase_hide',
  'phrase_unhide',
  'phrase_merge',
  // Transcription workbench: a curator created a brand-new lemma (an
  // entry the imported draft missed — `change.before` is null), or
  // verified an imported draft against the public-domain page scan
  // (`change` carries lemma + sense before/after plus the scan page id
  // and crop bbox the curator confirmed against).
  'lemma_create',
  'transcription_verify',
]);

export const lemmaEditHistory = pgTable(
  'lemma_edit_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Each edit refers to one word or one phrase.
    lemmaId: uuid('lemma_id').references(() => lemmas.id, {
      onDelete: 'cascade',
    }),
    phraseId: uuid('phrase_id').references(() => phrases.id, {
      onDelete: 'cascade',
    }),
    editorId: uuid('editor_id').references(() => users.id, { onDelete: 'set null' }),
    changeType: lemmaEditChangeType('change_type').notNull(),
    change: jsonb('change').$type<LemmaEditChangePayload>().notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lemmaIdx: index('lemma_edit_history_lemma_idx').on(t.lemmaId, t.createdAt),
    // parallel index for phrase audit lookups so
    // `selectPhraseHistory(phraseId)` is one indexed scan.
    phraseIdx: index('lemma_edit_history_phrase_idx').on(t.phraseId, t.createdAt),
    editorIdx: index('lemma_edit_history_editor_idx').on(t.editorId),
  }),
);

/**
 * JSON shape written into `lemma_edit_history.change`. Kept as an open
 * record so merge/split can store richer payloads without a
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
  bulkImportRow?: number;
  bulkPromote?: boolean;
  bulkAttribution?: boolean;
  // ordered snapshots of `(translationId, displayRank)` before
  // and after a `translation_reorder`. Stored as parallel arrays so the
  // history viewer can render either side as a list.
  translationOrderBefore?: Array<{ translationId: string; displayRank: number | null }>;
  translationOrderAfter?: Array<{ translationId: string; displayRank: number | null }>;
  // Transcription workbench: `lemma_create` snapshots the translations
  // created with the lemma; `transcription_verify` records the scan
  // page + crop the curator verified the entry against (before/after
  // carry the lemma + sense diff).
  translations?: Array<Record<string, unknown>>;
  scanPageId?: string;
  crop?: { x: number; y: number; w: number; h: number };
};

/**
 * The library uses the processing status to tell readers when they can open an uploaded text or
 * retry a failed import.
 */
export const textSourceType = pgEnum('text_source_type', [
  'paste',
  'txt',
  'epub',
  'zip',
  // PDF upload (image reader). The browser rasterizes each page to an
  // image client-side; the server stores only the page images and OCRs
  // them. One `text_chapters` row per page carries the page image, and
  // each `text_tokens` row carries a `bbox` so clicks on the image map
  // to words. The source PDF is never uploaded.
  'pdf',
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
    // An official text can remain publicly readable after its owner's account is removed.
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    language: language('language').notNull(),
    title: text('title').notNull(),
    sourceType: textSourceType('source_type').notNull(),
    status: textStatus('status').notNull().default('pending'),
    visibility: textVisibility('visibility').notNull().default('private'),
    // Catalog metadata and vocabulary remain public; source text requires staff.
    staffOnly: boolean('staff_only').notNull().default(false),
    statusError: text('status_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Library "your texts" tab needs a fast scan over the user's own
    // imports ordered by recency.
    ownerIdx: index('texts_owner_idx').on(t.ownerId, t.createdAt),
    visibilityIdx: index('texts_visibility_idx').on(t.visibility, t.language),
  }),
);

/** A direct share gives one recipient access to a text. Group shares are recorded separately. */
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
    recipientIdx: index('text_shares_recipient_idx').on(t.sharedWithUserId),
  }),
);

/** The group owner manages the roster and can view the group's learning statistics. */
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
 * Per-group text shares. Sibling of `text_shares`,
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
    hindiReviewRevision: uuid('hindi_review_revision'),
    // Cheap precompute on insert. The reader's library cards and
    // progress bars need it; computing it on read is wasteful.
    tokenCount: integer('token_count').notNull().default(0),
    // Original page image for PDF pages and illustrated EPUB sections.
    pageImageKey: text('page_image_key'),
    pageImageMime: text('page_image_mime'),
    pageWidth: integer('page_width'),
    pageHeight: integer('page_height'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    textOrderUq: unique('text_chapters_text_idx_uq').on(t.textId, t.idx),
    textIdx: index('text_chapters_text_idx').on(t.textId, t.idx),
  }),
);

export type User = InferSelectModel<typeof users>;
export type Session = InferSelectModel<typeof sessions>;
export type PersonalApiKey = InferSelectModel<typeof personalApiKeys>;
export type ApiRateLimitEvent = InferSelectModel<typeof apiRateLimitEvents>;
export type RefreshToken = InferSelectModel<typeof refreshTokens>;
export type MagicLink = InferSelectModel<typeof magicLinks>;
export type UserLanguage = InferSelectModel<typeof userLanguages>;
export type Lemma = InferSelectModel<typeof lemmas>;
export type LemmaForm = InferSelectModel<typeof lemmaForms>;
export type Phrase = InferSelectModel<typeof phrases>;
export type PhraseToken = InferSelectModel<typeof phraseTokens>;
export type Translation = InferSelectModel<typeof translations>;
export type TranslationVote = InferSelectModel<typeof translationVotes>;
export type TranslationReport = InferSelectModel<typeof translationReports>;
export type DictionaryImport = InferSelectModel<typeof dictionaryImports>;
export type CuratorLanguage = InferSelectModel<typeof curatorLanguages>;
export type LemmaEditHistoryEntry = InferSelectModel<typeof lemmaEditHistory>;
/** Track when an uploaded text is queued, starts processing, finishes or fails. */
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
 * Store tokens in reading order. Keep the parser's alternate entries alongside its first choice
 * so the reader can choose another meaning.
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
    /** digit-only NUM tokens carry a per-language spelled-out
     *  + ISO-15919 romanization payload so the reader pop-up can show
     *  e.g. "123 → एक सौ तेईस / ek sau teīs" without re-deriving on
     *  the client. Null on every other token. The shape mirrors
     *  `NumberForms` in the Python NLP service (services/nlp/app/numbers.py)
     *  and is delivered verbatim by the in-process dispatcher. */
    numberForms: jsonb('number_forms').$type<{
      value: string;
      digits_latin: string;
      digits_deva: string;
      digits_orya: string;
      hi: { spelled: string; romanized: string };
      mr: { spelled: string; romanized: string };
      odia: { spelled: string; romanized: string };
      // Basque (Latin script): `romanized` is empty — the spelled-out
      // form is the reading. Optional so chapters processed before
      // Basque number support keep type-checking.
      eu?: { spelled: string; romanized: string };
    } | null>(),
    /** PDF source only: the word's bounding box on the page image,
     *  normalized to 0..1 of the page width/height (resolution-
     *  independent so the reader overlay scales to whatever size the
     *  image renders at). Drives the clickable word hotspots in the
     *  image reader. Null for non-PDF tokens and for
     *  whitespace/punctuation tokens that have no clickable box. */
    bbox: jsonb('bbox').$type<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>(),
  },
  (t) => ({
    chapterIdx: unique('text_tokens_chapter_idx_uq').on(t.chapterId, t.idx),
    chapterScan: index('text_tokens_chapter_scan_idx').on(t.chapterId, t.idx),
    lemmaIdx: index('text_tokens_lemma_idx').on(t.lemmaId),
  }),
);

/**
 * Per-user known-words ledger.
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
    // The sentence the word was "mined" from, captured at mark-time so the
    // Anki export can show the context the user first met it in. Null when the
    // status was set outside a reading context (e.g. the words page).
    minedSentence: text('mined_sentence'),
    minedChapterId: uuid('mined_chapter_id').references(() => textChapters.id, {
      onDelete: 'set null',
    }),
    minedTokenIdx: integer('mined_token_idx'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.lemmaId] }),
    userIdx: index('user_known_lemmas_user_idx').on(t.userId, t.status),
  }),
);

/**
 * Save phrase matches when processing the chapter so opening it does not repeat the search. Both
 * token positions are inclusive. Overlapping matches are stored separately so the reader can
 * display the longest one.
 */
export const phraseChapterSpans = pgTable(
  'phrase_chapter_spans',
  {
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => textChapters.id, { onDelete: 'cascade' }),
    phraseId: uuid('phrase_id')
      .notNull()
      .references(() => phrases.id, { onDelete: 'cascade' }),
    startTokenIdx: integer('start_token_idx').notNull(),
    endTokenIdx: integer('end_token_idx').notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.chapterId, t.startTokenIdx, t.phraseId],
    }),
    // Drives `loadChapterTokens` — every span in this chapter in
    // one indexed scan.
    chapterIdx: index('phrase_chapter_spans_chapter_idx').on(t.chapterId),
    phraseIdx: index('phrase_chapter_spans_phrase_idx').on(t.phraseId),
  }),
);

/** Phrase suggestions saved by earlier imports for later review. */
export const phraseProposals = pgTable(
  'phrase_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    language: language('language').notNull(),
    surfaceNormalised: text('surface_normalised').notNull(),
    tokens: jsonb('tokens').$type<string[]>().notNull(),
    patternId: text('pattern_id').notNull(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => textChapters.id, { onDelete: 'cascade' }),
    /** Set when the periodic promotion pass has folded this
     *  proposal into a `phrases` row; null while still in the
     *  queue. Lets the pass be idempotent (re-running it skips
     *  already-promoted rows) and lets the curator dashboard
     *  surface the promotion event time. */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    promotedPhraseId: uuid('promoted_phrase_id').references(
      () => phrases.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Idempotent re-process: a worker that re-runs on the same
    // chapter after a re-tokenise must not duplicate proposals
    // for the same pattern hit.
    occurrenceUq: unique('phrase_proposals_occurrence_uq').on(
      t.chapterId,
      t.surfaceNormalised,
      t.patternId,
    ),
    // Promotion query reads `(language, surface_normalised)` and
    // counts distinct chapter_id; this index drives that
    // aggregation.
    promotionLookupIdx: index('phrase_proposals_promotion_lookup_idx').on(
      t.language,
      t.surfaceNormalised,
    ),
  }),
);

/**
 * Per-user known-status for phrases. Direct parallel to
 * `user_known_lemmas` — the `known_lemma_status` enum is reused
 * because the semantics (unknown / learning / known / ignored) are
 * identical for phrases. `setKnownPhraseStatus` updates this table
 * and recomputes `user_languages.known_phrases_count_cache` in the
 * same transaction.
 */
export const userKnownPhrases = pgTable(
  'user_known_phrases',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phraseId: uuid('phrase_id')
      .notNull()
      .references(() => phrases.id, { onDelete: 'cascade' }),
    status: knownLemmaStatus('status').notNull().default('learning'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.phraseId] }),
    userIdx: index('user_known_phrases_user_idx').on(t.userId, t.status),
  }),
);

/**
 * Per-user reading progress.
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
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
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
 * When enough different readers make the same correction in the same context, the worker can use
 * their choice for later occurrences.
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
    spellingIdx: index('form_lemma_overrides_spelling_idx')
      .on(t.language, sql`lower(normalize(${t.surfaceNfc}))`).where(sql`context_signature = ''`),
    lookupIdx: index('form_lemma_overrides_lookup_idx').on(
      t.language,
      t.surfaceNfc,
    ),
  }),
);

/**
 * Store a reader's correction for one token. They can choose a dictionary entry, propose a
 * missing word or mark the token as a proper name, punctuation or another non-word.
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
    // A proposed word may have no dictionary ID yet. Its details are stored in lemma_proposals.
    chosenLemmaId: uuid('chosen_lemma_id').references(() => lemmas.id, {
      onDelete: 'set null',
    }),
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
    // Aggregation worker groups by (lemma, type), index
    // matches that lookup so the cron stays cheap.
    lemmaIdx: index('token_corrections_chosen_lemma_idx').on(
      t.chosenLemmaId,
      t.type,
    ),
  }),
);

/** Accepting a proposal creates a dictionary entry and links the reader's correction to that entry. */
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
 * A personal correction changes one reader's view. A parse report asks a curator to review the
 * problem for everyone.
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
    // Use the same context signature as form_lemma_overrides so repeated reports can be matched
    // to the saved correction.
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
export type UserKnownPhrase = InferSelectModel<typeof userKnownPhrases>;
export type PhraseChapterSpan = InferSelectModel<typeof phraseChapterSpans>;
export type PhraseProposal = InferSelectModel<typeof phraseProposals>;
export type UserTextProgress = InferSelectModel<typeof userTextProgress>;
export type FormLemmaOverride = InferSelectModel<typeof formLemmaOverrides>;
export type TokenCorrection = InferSelectModel<typeof tokenCorrections>;
export type ParseReport = InferSelectModel<typeof parseReports>;
export type LemmaProposal = InferSelectModel<typeof lemmaProposals>;
export type TextShare = InferSelectModel<typeof textShares>;
export type Group = InferSelectModel<typeof groups>;
export type GroupMembership = InferSelectModel<typeof groupMemberships>;
export type TextGroupShare = InferSelectModel<typeof textGroupShares>;

/**
 * A collection groups texts in reading order. Courses can require completion before advancing.
 * Collections can also appear in the official library.
 */
export const collectionKind = pgEnum('collection_kind', [
  'chapter_book',
  'course',
  'anthology',
]);

export const collectionVisibility = pgEnum('collection_visibility', [
  'private',
  'shared',
  'official',
]);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    language: language('language').notNull(),
    kind: collectionKind('kind').notNull().default('chapter_book'),
    title: text('title').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    visibility: collectionVisibility('visibility').notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('collections_owner_idx').on(t.ownerId, t.createdAt),
    visibilityIdx: index('collections_visibility_idx').on(
      t.visibility,
      t.language,
    ),
  }),
);

/**
 * Position is local to the collection. Reordering a book in one collection leaves its position in
 * other collections alone.
 */
export const collectionItems = pgTable(
  'collection_items',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    // Optional parent-section label sourced from the publisher's
    // EPUB navigation document. When the source TOC nests chapters
    // under a Part heading (e.g. "Part 1: Make It Obvious"), each
    // member chapter records its parent here so the collection
    // detail page can render the same grouping. Null when the
    // chapter has no parent section (flat books, manually-curated
    // collections, etc.).
    sectionTitle: text('section_title'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.textId] }),
    orderIdx: index('collection_items_order_idx').on(
      t.collectionId,
      t.position,
    ),
  }),
);

/**
 * A collection share covers its current texts and any added later. Access is checked against
 * membership when the text is opened.
 */
export const collectionShares = pgTable(
  'collection_shares',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    sharedWithUserId: uuid('shared_with_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantedById: uuid('granted_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.sharedWithUserId] }),
    recipientIdx: index('collection_shares_recipient_idx').on(
      t.sharedWithUserId,
    ),
  }),
);

export type Collection = InferSelectModel<typeof collections>;
export type CollectionItem = InferSelectModel<typeof collectionItems>;
export type CollectionShare = InferSelectModel<typeof collectionShares>;

/**
 * Audio attached to texts / chapters.
 *
 * `audio_files` stores the metadata + storage location; the actual
 * blob lives in object storage (local volume in dev; Hetzner Object
 * Storage in prod). Each row binds an audio file to either a
 * specific chapter (chapter_id set) or to a whole text
 * (chapter_id=null, text_id set) — a single recording for an
 * audiobook chapter, or a "whole text" stream where the worker /
 * uploader chose not to chop per chapter.
 *
 * `mime` carries the Content-Type so the player can hand the
 * <audio> element the right hint (mp3 / m4a / ogg are all in
 * scope).
 *
 * `attribution` is the human-readable credit shown in the
 * player when present. `license` is the per-file license string;
 * official audio uploads carry an explicit license. User-uploaded
 * audio carries the redistribution-rights checkbox text from the
 * upload form.
 */
export const audioFiles = pgTable(
  'audio_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => textChapters.id, {
      onDelete: 'cascade',
    }),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms'),
    attribution: text('attribution'),
    license: text('license'),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    textIdx: index('audio_files_text_idx').on(t.textId),
    chapterIdx: index('audio_files_chapter_idx').on(t.chapterId),
  }),
);

/**
 * Aggregate listening time per user/audio file.
 *
 * The audio player sends small playback deltas while a signed-in reader is
 * listening. We store an aggregate rather than an event stream so the stats
 * page can cheaply compute minutes per language, text, and collection.
 */
export const userAudioListening = pgTable(
  'user_audio_listening',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    audioFileId: uuid('audio_file_id')
      .notNull()
      .references(() => audioFiles.id, { onDelete: 'cascade' }),
    textId: uuid('text_id')
      .notNull()
      .references(() => texts.id, { onDelete: 'cascade' }),
    listenedMs: integer('listened_ms').notNull().default(0),
    lastListenedAt: timestamp('last_listened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.audioFileId] }),
    userTextIdx: index('user_audio_listening_user_text_idx').on(
      t.userId,
      t.textId,
    ),
    textIdx: index('user_audio_listening_text_idx').on(t.textId),
  }),
);

/**
 * Audio timestamps link words in the text to positions in the recording. The source records how
 * the timing was obtained.
 */
export const alignmentSource = pgEnum('alignment_source', [
  'manual',
  'imported',
  'whisper',
]);

export const audioAlignments = pgTable(
  'audio_alignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    audioFileId: uuid('audio_file_id')
      .notNull()
      .references(() => audioFiles.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => textTokens.id, { onDelete: 'cascade' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    source: alignmentSource('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    audioFileTokenUq: unique('audio_alignments_audio_file_id_token_id_uq').on(
      t.audioFileId,
      t.tokenId,
    ),
    timelineIdx: index('audio_alignments_timeline_idx').on(
      t.audioFileId,
      t.startMs,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/* Dictionary scan transcription (workbench)                           */
/* ------------------------------------------------------------------ */

/**
 * Public-domain dictionary page scans backing the transcription
 * workbench. The imported DSAL rows are drafts; curators verify each
 * entry against these scans, at which point the lemma flips to
 * `curator_locked` with an own-transcription attribution (verification
 * state is derivable — no flag columns here or on `lemmas`).
 *
 * One `scan_volumes` row per ingested source PDF (see
 * scripts/ingest-scan.ts). It doubles as the calibration record:
 * printed page number = pdf page index + `page_offset`, valid within
 * [printed_page_start, printed_page_end] (Praharaj's seven volumes
 * share one continuous printed-page range, so resolution picks the
 * volume by range). `source_url` is the provenance note (archive.org
 * identifier) the ledger in docs/dictionary-sources.md points at.
 */
export const scanVolumes = pgTable(
  'scan_volumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dictionarySlug: text('dictionary_slug').notNull(),
    volumeNumber: integer('volume_number').notNull().default(1),
    sourceUrl: text('source_url').notNull(),
    sourceNote: text('source_note'),
    pageCount: integer('page_count').notNull(),
    pageOffset: integer('page_offset').notNull().default(0),
    printedPageStart: integer('printed_page_start'),
    printedPageEnd: integer('printed_page_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugVolumeUq: unique('scan_volumes_slug_volume_uq').on(t.dictionarySlug, t.volumeNumber),
  }),
);

export const scanOcrStatus = pgEnum('scan_ocr_status', ['pending', 'ok', 'failed']);

/**
 * One row per rasterized scan page. The OCR columns are a cache: the
 * first time the workbench opens a page it runs the raw Vision OCR
 * once and stores text + word boxes here (`ocr_words` is
 * `[{s, x, y, w, h}]`, boxes normalized 0..1 of the page dimensions —
 * the same convention as `text_tokens.bbox`).
 */
export const scanPages = pgTable(
  'scan_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    volumeId: uuid('volume_id')
      .notNull()
      .references(() => scanVolumes.id, { onDelete: 'cascade' }),
    pdfPageIndex: integer('pdf_page_index').notNull(),
    /** Printed page number; null for front/back matter outside the calibrated range. */
    printedPage: integer('printed_page'),
    imageKey: text('image_key').notNull(),
    imageMime: text('image_mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    ocrStatus: scanOcrStatus('ocr_status').notNull().default('pending'),
    ocrEngine: text('ocr_engine'),
    ocrText: text('ocr_text'),
    ocrWords: jsonb('ocr_words').$type<ScanOcrWord[]>(),
    ocrAt: timestamp('ocr_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    volumePageUq: unique('scan_pages_volume_page_uq').on(t.volumeId, t.pdfPageIndex),
    volumePrintedIdx: index('scan_pages_volume_printed_idx').on(t.volumeId, t.printedPage),
  }),
);

export type ScanOcrWord = { s: string; x: number; y: number; w: number; h: number };

/** Normalized 0..1 rectangle, matching the reader overlay convention. */
export type ScanCrop = { x: number; y: number; w: number; h: number };

/**
 * Where on the scans a lemma's printed entry lives — recorded when a
 * curator verifies (or re-points) an entry. The curator's choice is
 * ground truth: calibration drift in `scan_volumes.page_offset` never
 * invalidates a saved ref.
 */
export const lemmaScanRefs = pgTable(
  'lemma_scan_refs',
  {
    lemmaId: uuid('lemma_id')
      .primaryKey()
      .references(() => lemmas.id, { onDelete: 'cascade' }),
    scanPageId: uuid('scan_page_id')
      .notNull()
      .references(() => scanPages.id, { onDelete: 'cascade' }),
    crop: jsonb('crop').$type<ScanCrop>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageIdx: index('lemma_scan_refs_page_idx').on(t.scanPageId),
  }),
);

export const transcriptionIssueStatus = pgEnum('transcription_issue_status', [
  'open',
  'resolved',
]);

/**
 * "Flag a problem" state for the transcription queue (unreadable scan,
 * draft/scan mismatch, missing page, …). An open issue excludes the
 * entry from the default queue until a curator resolves it. Skip, by
 * contrast, is ephemeral client navigation and stores nothing.
 */
export const transcriptionIssues = pgTable(
  'transcription_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dictionarySlug: text('dictionary_slug').notNull(),
    lemmaId: uuid('lemma_id').references(() => lemmas.id, { onDelete: 'cascade' }),
    scanPageId: uuid('scan_page_id').references(() => scanPages.id, { onDelete: 'set null' }),
    note: text('note').notNull(),
    status: transcriptionIssueStatus('status').notNull().default('open'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugStatusIdx: index('transcription_issues_slug_status_idx').on(t.dictionarySlug, t.status),
    lemmaIdx: index('transcription_issues_lemma_idx').on(t.lemmaId),
  }),
);

export type AudioFile = InferSelectModel<typeof audioFiles>;
export type UserAudioListening = InferSelectModel<typeof userAudioListening>;
export type AudioAlignment = InferSelectModel<typeof audioAlignments>;
export type Paradigm = InferSelectModel<typeof paradigms>;
export type ParadigmSlot = InferSelectModel<typeof paradigmSlots>;
export type GrammarFeature = InferSelectModel<typeof grammarFeatures>;
export type ScanVolume = InferSelectModel<typeof scanVolumes>;
export type ScanPage = InferSelectModel<typeof scanPages>;
export type LemmaScanRef = InferSelectModel<typeof lemmaScanRefs>;
export type TranscriptionIssue = InferSelectModel<typeof transcriptionIssues>;

/** Current identity and explicit forms live in lemmas and lemma_forms. */
export const dictionaryEntries = pgTable('dictionary_entries', {
  lemmaId: uuid('lemma_id').primaryKey().references(() => lemmas.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull().unique(),
  entry: jsonb('entry').$type<Record<string, unknown>>().notNull(),
});

export const dictionaryPatternForms = pgTable('dictionary_pattern_forms', {
  lemmaId: uuid('lemma_id').notNull().references(() => lemmas.id, { onDelete: 'cascade' }),
  surface: text('surface').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.lemmaId, t.surface] }) }));

export const hindiDictionaryState = pgTable('hindi_dictionary_state', {
  id: integer('id').primaryKey().default(1),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
});

export const hindiChapterAnalyses = pgTable('hindi_chapter_analyses', {
  chapterId: uuid('chapter_id').primaryKey().references(() => textChapters.id, { onDelete: 'cascade' }),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  parserVersion: text('parser_version').notNull(),
  sourceWords: integer('source_words').notNull(),
  unresolvedWords: integer('unresolved_words').notNull(),
  stats: jsonb('stats').$type<Record<string, unknown>>().notNull(),
});

/** Every supported candidate at a source span, including overlapping compounds. */
export const hindiOccurrences = pgTable('hindi_occurrences', {
  chapterId: uuid('chapter_id').notNull().references(() => textChapters.id, { onDelete: 'cascade' }),
  startIdx: integer('start_idx').notNull(),
  endIdx: integer('end_idx').notNull(),
  lemmaId: uuid('lemma_id').notNull().references(() => lemmas.id, { onDelete: 'cascade' }),
  sourceStart: integer('source_start').notNull(),
  sourceEnd: integer('source_end').notNull(),
  rules: jsonb('rules').$type<string[]>().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.chapterId, t.startIdx, t.endIdx, t.lemmaId] }),
  lemmaIdx: index('hindi_occurrences_lemma_idx').on(t.lemmaId, t.chapterId),
}));

export const hindiImportedBooks = pgTable('hindi_imported_books', {
  sourceVersionId: text('source_version_id').primaryKey(),
  textId: uuid('text_id').notNull().references(() => texts.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
});

export const officialTextCopies = pgTable('official_text_copies', {
  sourceTextId: uuid('source_text_id').notNull().references(() => texts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  textId: uuid('text_id').notNull().references(() => texts.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.sourceTextId, t.userId] }) }));

/** Context choices never remove the parser's other supported candidates. */
export const hindiContextChoices = pgTable('hindi_context_choices', {
  chapterId: uuid('chapter_id').notNull().references(() => textChapters.id, { onDelete: 'cascade' }),
  sourceOccurrenceId: text('source_occurrence_id').notNull(),
  sourceStart: integer('source_start').notNull(),
  sourceEnd: integer('source_end').notNull(),
  selectedLemmaIds: jsonb('selected_lemma_ids').$type<string[]>().notNull(),
  candidateLemmaIds: jsonb('candidate_lemma_ids').$type<string[]>().notNull(),
  origin: text('origin').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.chapterId, t.sourceOccurrenceId] }),
}));

export const hindiReviewIgnored = pgTable('hindi_review_ignored', {
  textId: uuid('text_id').notNull().references(() => texts.id, { onDelete: 'cascade' }),
  surface: text('surface').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.textId, t.surface] }) }));

export const hindiReferenceCache = pgTable('hindi_reference_cache', {
  key: text('key').primaryKey(),
  result: jsonb('result').notNull(),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bookWordFrequencies = pgTable('book_word_frequencies', {
  textId: uuid('text_id').notNull().references(() => texts.id, { onDelete: 'cascade' }),
  lemmaId: uuid('lemma_id'),
  occurrences: integer('occurrences').notNull(),
}, t => ({
  entry: unique().on(t.textId, t.lemmaId).nullsNotDistinct(),
  byLemma: index('book_word_frequencies_lemma_idx').on(t.lemmaId, t.textId),
}));

export const chapterWordFrequencies = pgTable('chapter_word_frequencies', {
  chapterId: uuid('chapter_id').notNull().references(() => textChapters.id, { onDelete: 'cascade' }),
  lemmaId: uuid('lemma_id'),
  occurrences: integer('occurrences').notNull(),
}, t => ({
  entry: unique().on(t.chapterId, t.lemmaId).nullsNotDistinct(),
}));

export const pendingFrequencyChapters = pgTable('pending_frequency_chapters', {
  chapterId: uuid('chapter_id').primaryKey(),
});
export const pendingFrequencyBooks = pgTable('pending_frequency_books', {
  textId: uuid('text_id').primaryKey(),
});

export const readerVocabularyRevisions = pgTable('reader_vocabulary_revisions', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  revision: bigint('revision', { mode: 'number' }).notNull(),
});

export const officialCoverageGeneration = pgTable('official_coverage_generation', {
  singleton: boolean('singleton').primaryKey(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
});

export const officialCoverageLayouts = pgTable('official_coverage_layouts', {
  revision: bigint('revision', { mode: 'number' }).primaryKey(),
  bookIds: uuid('book_ids').array().notNull(),
  words: integer('words').array().notNull(),
  uniqueWords: integer('unique_words').array().notNull(),
  unresolved: integer('unresolved').array().notNull(),
});

export const readerCoverageCache = pgTable('reader_coverage_cache', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  catalogRevision: bigint('catalog_revision', { mode: 'number' }).notNull().references(() => officialCoverageLayouts.revision),
  vocabularyRevision: bigint('vocabulary_revision', { mode: 'number' }).notNull(),
  knownWords: integer('known_words').array().notNull(),
  learningWords: integer('learning_words').array().notNull(),
  knownEntries: integer('known_entries').array().notNull(),
  learningEntries: integer('learning_entries').array(),
}, t => ({
  byLayout: index('reader_coverage_layout_idx').on(t.catalogRevision),
}));
