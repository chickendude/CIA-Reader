# HindiDB in Parhiba

HindiDB is Parhiba’s dictionary format. Each entry has a root word, its accepted forms,
and any saved spelling rules or exceptions. The reader matches passages against the
editable PostgreSQL dictionary. To set up entries for another supported language, open
**Dictionary > Edit dictionary**, choose **New entry**, and enter the headword, part of
speech, and meaning. Enter additional spellings in **Other forms**, separated by commas. Alternative headwords and exclusions also affect
reader matching. Reprocess an existing book to refresh its saved matches.

For suffix patterns, an admin can create a paradigm and its slots under
**Dictionary moderation > Paradigms**. Under **Inflection pattern**, select the saved pattern for the entry's language and part of speech,
enter the stem, and choose **Apply pattern**.
Saving the draft makes those forms available to the reader.

For rules that need custom logic, register a `savedFormProfile` in
`apps/web/src/lib/dictionary/profiles.ts`. Each pattern supplies an ID, label, an
`applies(lemma, pos)` predicate, and a `forms(lemma)` generator. The workshop previews
the selected pattern and indexes its spellings on save. Languages without a registered
pattern use their explicit forms. The same editor can merge entries in every supported language.
A profile can supply negative markers for phrase variants. Source retrieval, report
generation, and extra book analysis can be registered independently in
`apps/web/src/lib/server/dictionary/workshop-adapters.ts`. Hindi uses these hooks for
Hindwi and Rekhta, spelling reports, and stutter review.

## Local migration, 2026-11-17

- Imported all 23,435 effective lexical entries after applying the seed,
  Wiktionary foundation, local overrides, and 570 deleted-entry records.
- Preserved 35,403 source definition records, 86,607 explicit forms,
  reviewed inflection inventories, exclusions, spelling variants, entry groups,
  and provenance in `hindi_entries.entry`.
- English meanings follow HindiDB's reader: prefer each record's translation,
  otherwise its English original, then join the meanings with `; `. One editable
  translation per entry; commas within a meaning remain unchanged. The reader
  displays numbered meanings without semicolons only in the small hover preview.
  The clicked-word panel keeps plain semicolon-separated definitions.
  The clicked panel exposes all candidate POS entries independently. Hover shows
  selected entries when context choices exist, otherwise all candidates.
- Replaced the previous Hindi dictionary, phrases, derived forms, and overrides.
  Matched study states by exact headword and POS; unmatched states were archived.
- Rebuilt all 50 existing Hindi chapters: 77,886 source words, 108,248 candidate
  occurrences, and 3,760 unresolved word occurrences. These are parser counts,
  not a linguistic accuracy measurement.
- Verified all 23,435 English meanings against HindiDB with zero mismatches.
  No old Hindi translation source rows remain.

A fresh PostgreSQL backup and hashed source snapshots are under
`.local/backups/` and `.local/hindidb-source/`. The snapshot includes a WAL-aware
backup of HindiDB's review database. Original definitions and evidence stay in
metadata, rather than appearing alongside reviewed meanings in the reader.
The 55 GB HindiDB library-analysis database is read in place in read-only mode;
its historical analyses are not copied. Parhiba's existing text bodies,
collections, and reading progress were retained.

## Harry Potter and Official library

The two current HindiDB books are imported: Harry Potter 1 (98,795 words) and
Harry Potter 2 (111,085 words). Superseded source versions are excluded. Their
complete original texts were verified exactly against archived source snapshots.
Books are divided into manageable reader parts without cutting sentences or
lexical spans. Source snapshots and all current decision records are archived
under `.local/hindidb-books/`; a PostgreSQL backup precedes the import.

All 61,110 current decisions were preserved: 60,660 AI selections, 80 human
selections, and 370 abstentions. Selections identify dictionary entries/POS uses,
not individual English senses. Of these, 59,929 AI selections and 76 human
selections still match current candidates and passages. Another 927 decisions
need review; all their original choices, snapshots, reasons, and model metadata
remain available. Candidate or passage changes invalidate display preferences;
definition-only edits do not. Selecting a displayed entry never removes other
candidates from frequencies or coverage.

Both books appear in **Library → Official**. Each catalog page shows word counts,
personal known and known + learning coverage, and Anki downloads for unseen,
learning, or all vocabulary. Decks contain dictionary definitions and frequencies,
not source passages; note GUIDs use stable dictionary UUIDs. Full reading and
personal imports require a curator or admin role. Copies preserve all chapters,
analyses, and saved choices, stay private and staff-only, and repeat imports reuse
the existing copy. Normal users cannot bypass the restriction through chapter,
sentence translation, mining, or the older sentence-bearing Anki exporter.
Books already owned by the viewer remain in **Your library** and show **Open in
my library**, without creating another copy.

Anki exports use a temporary SQLite database because `.apkg` contains Anki's
SQLite collection. Application data remains in PostgreSQL. Node's built-in
SQLite supports decks larger than the former 16 MB limit.

Admins can use **Add to Official** on a ready book in their personal library.
New promotions restrict full reading to staff while exposing catalog metadata.

## Editing and analysis

Use Parhiba's dictionary editor for meanings and the Hindi morphology section
for paradigms, explicit forms, alternative headwords, and exclusions. Source
review metadata and inflection inventories are retained. Deleting a form in the
ordinary form editor excludes that spelling from generated matching as well.
Parsing-relevant edits invalidate the in-process lexicon cache and mark saved
analyses stale; definition-only edits do not. Reprocess affected books to refresh
existing tokens and counts. The parser preserves every supported candidate,
overlapping compounds and their components, and original character offsets.
Matching rules remain in `hindi_occurrences.rules`, not the reader's form chips.

`hindi_occurrences` is the authoritative span/entry table. `text_tokens` provides
reader display tokens and alternatives. A selected display lemma does not erase
other candidates from frequency or coverage. Grammatical constructions are
stored separately and do not count as vocabulary occurrences.

Staff with dictionary rights for the reading language can click a definition in
the popup and save the canonical wording inline. Enter or blur saves; Escape
cancels. The editor occupies the original definition box and focuses immediately.
The server enforces the same
language-specific curator/admin permission as the dictionary editor. Normal
readers see read-only meanings and use “Fix this word” for corrections. Saved
definitions update hover text immediately and the persisted canonical gloss;
meaning edits do not invalidate parsing. Each candidate's study state and
frequency remain independent.

The **Dictionary** navigation item opens the current language's dictionary.
Staff can follow **Unparsed words and context review** to inspect a book's
occurrences requiring attention. This includes stale decisions, uncertain decisions,
occurrences with no fitting entry, unresolved choices between entry groups covering
the same span, and unparsed words. Valid selections leave the attention queue.
The status dropdown shows live counts for the current book and word filter,
including AI suggestions and confirmations. The other review lists show unparsed spellings by frequency and ambiguous
reader tokens, including overlapping phrases.

In the reader or review page, **Confirm here** saves a human context choice;
click a confirmed entry again to clear it. Multiple entries can be confirmed.
Book owners can review their own books, and staff can review Official books.
Changes update the reader immediately, retain imported evidence and review
history, and use a version check to reject stale saves.

The staff review page offers **AI check next N** for up to five unselected
occurrences on the current page. It uses `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and
`OPENAI_MODEL` only when clicked. The precise occurrence, surrounding passage,
and supported dictionary candidates are sent to the configured provider.
Suggestions remain labelled as AI; human confirmations are never overwritten.
Unsupported IDs are rejected and uncertain or no-match answers are retained.
The original HindiDB directory is not needed for these review tools.

## Counts

The statistics page shows source words, unique vocabulary, known coverage,
known + learning coverage, and unresolved counts for texts and collections.
Source words are counted once. Candidate frequency counts each distinct
span/entry once, so ambiguity and overlapping lexical compounds can make it
larger than the source-word count. Coverage uses candidate occurrences plus
unresolved word gaps as its denominator. Known and learning remain separate;
marking one POS use known does not mark its alternatives known. Unique vocabulary
uses HindiDB's explicit group primary where applicable. Numeric, punctuation,
and foreign-script tokens remain excluded according to HindiDB's parser policy.

## Commands

The user controls app startup and shutdown. To start the local stack:

```sh
./scripts/dev-local.sh start
```

For a fresh local database only:

```sh
./scripts/dev-local.sh import-hindidb /path/to/HindiDB
./scripts/dev-local.sh reprocess-hindi
```

To import the current Harry Potter books from another HindiDB checkout:

```sh
./scripts/dev-local.sh import-hindidb-books /path/to/HindiDB LOCAL_USER_UUID
```

The book importer backs up first and skips already-imported source versions,
preserving subsequent Parhiba edits. For a read-only inventory, run
`scripts/import_hindidb_books.py` with the NLP venv, `DATABASE_URL`, and `--owner`
but omit `--apply`. It only connects to a loopback PostgreSQL database.

The importer makes a backup, restricts replacement to a loopback database, and
refuses a second import after migration so it cannot overwrite subsequent edits.
Reprocessing runs without starting a server. Existing PDF token boxes are aligned
to replacement tokens; an alignment failure keeps that chapter's old analysis.
Unchanged source spans retain token UUIDs and their attached corrections.
Numbers remain outside vocabulary totals but have clickable Hindi readings,
including reference numbers, Devanagari years, decimals, and percentages.
Source offsets are Python Unicode code-point offsets, not JavaScript UTF-16 offsets.

The optional `hindidb.integration.test.ts` uses `HINDIDB_TEST_DATABASE_URL` and
rolls back all fixture writes. It verifies candidate storage, known/learning
transitions, unresolved gaps, collection counts, exact-POS frequencies, and
revision invalidation. NLP adapter tests cover overlapping candidates,
exclusions, constructions, and source-text alignment.
