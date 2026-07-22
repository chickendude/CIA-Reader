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

/**
 * Personal API keys for mobile / third-party clients. The plaintext key is
 * returned once at creation time; only SHA-256(key) is stored. Revocation is a
 * soft delete so the profile page can show key history without leaking secret
 * material.
 */
export const personalApiKeys = pgTable(
  'personal_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashUnique: unique('personal_api_keys_hash_unique').on(t.keyHash),
    userIdx: index('personal_api_keys_user_idx').on(t.userId),
    activeUserIdx: index('personal_api_keys_active_user_idx').on(t.userId, t.revokedAt),
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
    // T-14.1: parallel counter for phrases (M14). `setKnownPhraseStatus`
    // recomputes this in the same transaction as the status flip,
    // mirroring the words counter. Surfaced in T-14.6's stats panes.
    knownPhrasesCountCache: integer('known_phrases_count_cache').notNull().default(0),
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
  // T-14.5a: rule-based NLP-promoted phrase entries. The
  // detector (T-14.5, services/nlp/app/phrases) emits proposals;
  // a periodic promotion pass (this ticket) creates `phrases`
  // rows with this source once a proposal crosses the chapter
  // occurrence threshold. `lemmas` rows never carry this
  // source — `nlp` is phrase-only.
  'nlp',
]);

export const translationVoteValue = pgEnum('translation_vote_value', [
  'up',
  'down',
]);

/**
 * Polymorphic target for `translations` (T-14.1).
 *
 * A translation row attaches to either a single `lemmas` row (the
 * legacy default — every pre-M14 row was implicitly 'lemma') or to a
 * `phrases` row (M14 phrase-level translations). The (target_type,
 * target_id) pair is the canonical join key going forward; the
 * legacy `lemma_id` column on `translations` is kept populated for
 * 'lemma' rows during T-14.1's overlap window and dropped in T-14.7.
 *
 * No native Postgres FK on `target_id` because it points at two
 * tables — application layer (`translations.ts` / `phrases.ts`)
 * enforces target existence on every write.
 */
export const translationTargetType = pgEnum('translation_target_type', [
  'lemma',
  'phrase',
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
    // #318: fold-agnostic search column. Postgres-side mirror of
    // the JS `stripNukta` helper in `@ciareader/shared-types/nukta`:
    // NFD-normalize so atomic precomposed nukta consonants
    // (U+0958..U+095F + U+0929) decompose to base + U+093C, then
    // delete every U+093C; additionally fold the Hebrew ligatures
    // (U+05F0 װ / U+05F1 ױ / U+05F2 ײ → letter pairs) and normalize
    // pasekh-on-first-yud to pasekh-on-second so both Yiddish typing
    // conventions hit the same key. The result is what the search
    // query also gets reduced to before the fallback compares them.
    // STORED because we read it on every fallback search; the index
    // below must be on the materialized column. Generated columns
    // require an IMMUTABLE expression — `normalize`, `translate` and
    // `replace` all are. Keep in lockstep with stripNukta.
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
    // #318: index for the nukta-agnostic ILIKE prefix fallback. Same
    // shape as the canonical headword index so the planner can pick
    // it without a re-collation.
    headwordStrippedIdx: index('lemmas_language_headword_stripped_idx').on(
      t.language,
      t.headwordNuktaStripped,
    ),
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
 * Multi-word dictionary entries (T-14.1, M14 phrase-level translations).
 *
 * A phrase is identified by its ordered token sequence (see
 * `phrase_tokens`) — `surface_normalised` is only the dedupe lookup
 * column (joined surfaces, NFC, single-space). Per-source duplicates
 * are allowed by design (mirrors lemmas merge story from T-3.10): a
 * curator phrase and a Kaikki-imported phrase with the same surface
 * are kept as separate rows and reconciled via the merge UI in T-14.7.
 *
 * Sources reuse the existing `translation_source` enum. T-14.5
 * extends that enum with `'nlp'` for compound/conjunct verb
 * proposals from the rule-based detector.
 *
 * `curator_locked = true` mirrors the same flag on `lemmas`: a human
 * has touched this row and importers must not clobber it.
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
    // T-14.7: moderation flag mirroring the lemma-side translation
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
    // Non-unique by design — per-source duplication is reconciled in
    // T-14.7's merge UI, same as lemmas (T-3.10).
    surfaceIdx: index('phrases_language_surface_idx').on(t.language, t.surfaceNormalised),
    languageIdx: index('phrases_language_idx').on(t.language),
    frequencyIdx: index('phrases_language_frequency_idx').on(t.language, t.frequencyRank),
    // Idempotent re-import: an importer finds its own previously-
    // written row by (language, source, source_id).
    sourceIdx: index('phrases_source_lookup_idx').on(t.language, t.source, t.sourceId),
  }),
);

/**
 * Ordered token components of a phrase (T-14.1). The canonical
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
    // Drives the chapter-span resolver in T-14.2: "every phrase
    // whose first surface is X" is a single index lookup.
    surfaceIdx: index('phrase_tokens_surface_idx').on(t.surface),
  }),
);

/**
 * Translation rows for a lemma OR a phrase (T-14.1 polymorphic).
 * Officials, curator edits, and user submissions all live here and
 * are distinguished by `source`. A user can fork an official into a
 * personal copy via `parent_translation_id` (T-3.5) — the fork is
 * visible only to the forker and renders at the top of the pop-up
 * for them specifically.
 *
 * `hidden` is the moderation switch for community translations;
 * officials are edited in place (with an audit trail in T-3.4's
 * `lemma_edit_history`) rather than hidden.
 *
 * Polymorphic target (T-14.1): the canonical join key is
 * `(target_type, target_id)`. T-14.7a dropped the legacy
 * `lemma_id` column after every read/write path moved to the
 * target pair.
 *
 * No native FK on `target_id` because it points at two tables —
 * the service layer (`translations.ts` / `phrases.ts`) enforces
 * target existence on every write.
 */
export const translations = pgTable(
  'translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: translationTargetType('target_type').notNull().default('lemma'),
    // Canonical polymorphic target. T-14.7a dropped the legacy
    // `lemma_id` column; reads / writes go through this pair.
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
    // T-14.1 canonical lookup index. Reader pop-up + dictionary
    // editor read by (target_type, target_id) and re-import dedup
    // adds `source` as the third column for the importer fast path.
    targetIdx: index('translations_target_idx').on(t.targetType, t.targetId, t.source),
    submittedByIdx: index('translations_submitted_by_idx').on(t.submittedBy),
    // T-14.7a: importer dedup key. Replaces the legacy
    // `(lemma_id, source, source_id)` index that was dropped
    // alongside the column. The polymorphic shape lets future
    // phrase-source importers re-use the same path.
    sourceLookupIdx: index('translations_source_lookup_idx').on(
      t.targetType,
      t.targetId,
      t.source,
      t.sourceId,
    ),
  }),
);

/**
 * Per-user votes on community translations (T-10.4).
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
 * Reader-submitted reports flagging community translations for moderation
 * (T-11.1). Officials and curator rows are edited in place by curators; this
 * queue exists for `source='user'` translations only and is the input to the
 * `/moderation/translations` review page.
 *
 * Resolution semantics:
 *  - `resolved_hidden` — moderator hid the translation. The hide flip and the
 *    `bulkResolveByTranslation` write happen in one transaction so the
 *    `lemma_edit_history` audit row and the report status stay consistent.
 *  - `resolved_kept` — moderator reviewed and decided the translation is fine.
 *    Future reports on the same row create new open rows; "kept" is the
 *    decision on this batch only.
 *  - `dismissed` — moderator closed a single report without acting on the
 *    translation (e.g. duplicate of an existing open report from the same
 *    reporter, or a misuse of the flow). Other open reports on the same
 *    translation are unaffected.
 *
 * `(reporter_id, translation_id)` is unique so a single user can't pile up
 * reports on the same translation. Re-submitting from the API yields 409.
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
 * Audit row per dictionary-import run. One row written per `runImport(...)`
 * invocation so we can answer "when did we last pull Hindi WordNet and
 * what changed?" without re-reading the source file or scanning lemmas.
 *
 * T-3.14 added `triggered_by_user_id`, `status`, and `error_message` so
 * the admin sources page can show "who kicked it off" and surface a
 * failure without scraping logs. CLI runs via
 * `pnpm dictionary:import` leave `triggered_by_user_id` null — they're
 * still recorded as `succeeded` (or `failed`) so the page's "last
 * import" cell is honest about CLI activity too.
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
  // T-14.7: phrase-side audit rows ride on the same table — the
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
    // T-14.7: nullable as of M14 so phrase audit rows live in the
    // same table without a parallel `phrase_edit_history`. Each
    // row sets exactly one of `lemmaId` / `phraseId` (enforced
    // via CHECK in migration 0028); the change-type enum tells
    // the audit reader which side to interpret.
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
    // T-14.7: parallel index for phrase audit lookups so
    // `selectPhraseHistory(phraseId)` is one indexed scan.
    phraseIdx: index('lemma_edit_history_phrase_idx').on(t.phraseId, t.createdAt),
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
    // PDF source only: when a chapter represents a PDF page, these hold
    // the stored page image (rasterized client-side, OCR'd server-side)
    // so the reader can show the original page with clickable word
    // overlays. Null for paste / txt / epub / zip chapters.
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
    /** T-2.8: digit-only NUM tokens carry a per-language spelled-out
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
 * Materialised phrase occurrences per chapter (T-14.2).
 *
 * The chapter-span resolver (`server/texts/phrase-spans.ts`) builds
 * this table when the worker writes `text_tokens` and on every text
 * reprocess. Each row is one occurrence of a `phrases` row inside a
 * chapter — `start_token_idx` and `end_token_idx` are inclusive
 * `text_tokens.idx` values for the first and last tokens covered by
 * the span.
 *
 * Why a materialised table rather than computing on chapter load:
 * resolution joins phrase_tokens by first-surface against the
 * chapter's tokens. For a 7000-token chapter against the language's
 * full phrase set, that's a non-trivial pass to repeat per page
 * load. Building once on write keeps the reader hot path cheap and
 * makes T-14.6's "phrases this user has seen" stats query trivial.
 *
 * The same start position can host multiple phrases — longer phrase
 * winning over a shorter one is a render-time decision, not a
 * storage one. PK is `(chapter_id, start_token_idx, phrase_id)` so
 * overlapping phrases coexist; T-14.3's reader UI picks the longest
 * containing span for the visible wrapper element and exposes the
 * shorter ones via `data-phrase-overlap`.
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
    // Drives T-14.6 stats — every chapter a given phrase appears in.
    phraseIdx: index('phrase_chapter_spans_phrase_idx').on(t.phraseId),
  }),
);

/**
 * Queue of NLP-detected phrase proposals (T-14.5a).
 *
 * The web worker writes one row here per `(chapter,
 * surface_normalised, pattern_id)` triple emitted by
 * `services/nlp/app/phrases` after Stanza finishes a chapter.
 * A periodic promotion pass (`promotePhraseProposals`) walks
 * the queue, counts distinct chapters per
 * `(language, surface_normalised)`, and creates a `phrases` row
 * (`source='nlp'`, `phrase_tokens` from the stored ordered
 * `tokens`) once the count crosses
 * `PHRASE_PROMOTION_MIN_CHAPTERS` (default 3).
 *
 * Why a queue + threshold instead of inserting `phrases`
 * directly: rule-based detectors throw off false positives at
 * a steady rate; promoting only patterns that recur across
 * multiple chapters is the simplest filter for noise without a
 * per-pattern precision audit. Unique on
 * `(chapter_id, surface_normalised, pattern_id)` so re-running
 * the worker on the same chapter is idempotent.
 *
 * `tokens` carries the ordered surfaces the matcher saw — the
 * promotion pass writes `phrase_tokens` from this array
 * verbatim so the eventual phrase row matches the chapter
 * occurrences exactly.
 */
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
 * Per-user known-status for phrases (T-14.1). Direct parallel to
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
 * Collections — chapter books, courses, anthologies (T-8.1).
 *
 * A collection is an ordered group of texts that share a language.
 * `kind` drives the per-item behaviour:
 *
 *   - `chapter_book`: the standard ordered grouping (e.g. a novel
 *     split into chapter-per-text imports).
 *   - `course`: stricter ordering (T-8.6 — the next item is gated
 *     until the prior is finished, overridable).
 *   - `anthology`: order is curatorial but not enforced; the reader
 *     surfaces "next" but doesn't gate it.
 *
 * Visibility mirrors `texts.visibility`. An admin can promote a
 * collection to `official` for the public-library path (T-7.6
 * surfaces texts; T-8.5 surfaces collections in the same library
 * tab).
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
 * Ordered membership of a text in a collection. A text can belong
 * to multiple collections (an excerpt that's part of both a
 * chapter book AND a course); `position` carries the curator's
 * intended order WITHIN the collection. The (collection_id, text_id)
 * primary key + the (collection_id, position) index covers the
 * "show me this collection's items in order" lookup that the detail
 * page hits.
 *
 * Reorder is by rewriting `position` on every member — O(n) but n
 * is small (a chapter book of 100+ items is unusual). T-8.1's drag-
 * and-drop UI calls a single PATCH that hands back the new order.
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
 * Per-recipient share grant on a collection (T-8.4). The owner
 * grants a single user read access to the whole collection;
 * canReadText extends to allow any (text_id, viewer.id) pair where
 * the text is a member of a collection the viewer has been granted.
 *
 * Adding a text to a collection propagates the grant automatically
 * — the share row is on the COLLECTION, not on individual member
 * texts, so the join is computed at read time instead of expanded
 * at grant time.
 *
 * MVP only models 'read' permission. Reserved for read/write
 * distinctions later.
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
 * Audio attached to texts / chapters (T-9.1).
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
 * `attribution` (T-9.7) is the human-readable credit shown in the
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
 * Aggregate listening time per user/audio file (T-10.5).
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
 * Per-token timing for an audio file (T-9.3 / T-9.5 / T-9.6).
 *
 * One row per (audio_file, token) pair. Optional — a chapter can
 * have audio without alignments (the player still works, just no
 * karaoke highlight). Times are stored in milliseconds from the
 * start of the audio file. Indexed on (audio_file_id, start_ms)
 * for the timeupdate-driven binary search the reader runs every
 * frame while playback is active.
 *
 * Source: `manual` (T-9.5 editor) or `imported` (T-9.6 JSON / VTT
 * import), with `whisper` reserved for the future ASR-aligned
 * branch.
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
