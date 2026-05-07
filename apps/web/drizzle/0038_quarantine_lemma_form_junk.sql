-- One-shot quarantine pass over `lemma_forms`.
--
-- The Kaikki form-extraction path was too lenient and slurped up
-- Wiktionary template names (`hi-ndecl`, `no-table-tags`),
-- IAST-romanization strings that should have been in the
-- `romanization` column (`bhautikśāstra`), Wiktionary template
-- placeholders (`{{{2}}}`), and even full English sentences
-- ("Oblique Note: The oblique case precedes all postpositions.").
-- About 17 % of all rows are affected — they don't get deleted
-- because some are salvageable (the IAST rows in particular), but
-- they are flagged so the dispatcher's surface-lookup tier
-- (filtered on `quarantined_at IS NULL`) can't resolve them, and a
-- future admin review can drain the queue.

-- 1) Wiktionary template / parameter names. These are tokens that
--    look like `hi-ndecl` / `no-table-tags` / `hi-conj` — pure
--    lowercase ASCII and dashes/digits, no script content. Cheap
--    rule, very high precision.
UPDATE "lemma_forms"
SET "quarantined_at" = NOW(),
    "quarantine_reason" = 'wiktionary template name'
WHERE "quarantined_at" IS NULL
  AND "surface" ~ '^[a-z][a-z0-9-]*$';

-- 2) Wiktionary template placeholder leftovers (`{{{2}}}ā` etc.).
--    Anything containing `{`, `}`, `[`, `]`, `<`, `>`, `=`, `\` is
--    almost certainly markup that escaped the parser.
UPDATE "lemma_forms"
SET "quarantined_at" = NOW(),
    "quarantine_reason" = 'wiktionary template markup'
WHERE "quarantined_at" IS NULL
  AND "surface" ~ '[\{\}\[\]<>=\\]';

-- 3) Latin letters appearing in a row whose lemma is in a
--    non-Latin-script language. Catches IAST romanizations stored
--    in the surface column, English sentences, and
--    Devanagari-with-Latin-suffix template-render bugs. Some IAST
--    rows could later be salvaged by moving the value into
--    `romanization` and recovering the native-script surface from
--    Stanza output — for now the safer move is to keep them out of
--    the dispatcher's resolution tier.
UPDATE "lemma_forms" lf
SET "quarantined_at" = NOW(),
    "quarantine_reason" = 'latin letters in non-latin-language surface'
FROM "lemmas" l
WHERE l."id" = lf."lemma_id"
  AND lf."quarantined_at" IS NULL
  AND lf."surface" ~ '[A-Za-z]'
  AND l."language" IN ('hi', 'mr', 'or');

-- 4) Empty / whitespace-only surfaces. Defensive — there may be a
--    handful from earlier import bugs; the surface index is
--    useless for these.
UPDATE "lemma_forms"
SET "quarantined_at" = NOW(),
    "quarantine_reason" = 'empty surface'
WHERE "quarantined_at" IS NULL
  AND btrim("surface") = '';
