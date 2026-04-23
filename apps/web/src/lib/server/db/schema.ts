/**
 * Drizzle schema — intentionally empty for M0.
 *
 * M0 proves migrations tooling works end-to-end with an empty schema. Real
 * tables land incrementally: users/user_languages in M1, texts/chapters in
 * M4, lemmas/tokens in M2/M3, corrections + overrides in M6, groups/shares
 * in M7, collections in M8, audio in M9.
 */
export {};
