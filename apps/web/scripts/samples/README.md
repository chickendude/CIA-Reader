# Homograph-alternates — how to test it by hand

This exercises the "pickable alternate lemma tabs" feature: a curated
`form_lemma_overrides` row carries `alternate_lemma_ids` beside its chosen
default, and the reader offers those alternates as parse tabs when you tap the
word.

`homograph-sample-eu.txt` is a short Basque passage that uses the three sample
surfaces (`galera`, `ilaran`, `ordena`).

## Steps

1. **Seed the sample overrides** (inserts the eu overrides *with* alternates,
   creating the lemmas if needed):

   ```
   node apps/web/scripts/seed-homograph-samples.mjs
   ```

2. **Get the sample text processed** — the alternates are baked into a token's
   candidates at *process* time, so the seed must exist **before** processing:

   - **New upload (simplest):** upload `homograph-sample-eu.txt` as a Basque
     (`eu`) text through the web app. New uploads process via the in-app
     dispatcher, which loads the alternates.
   - **Existing text:** if you already have an `eu` text containing these words,
     reprocess it after seeding:

     ```
     node apps/web/scripts/reprocess-text.mjs <textId>
     ```

     (The reprocess script loads `alternate_lemma_ids` too, mirroring the
     dispatcher; watch for `… (N with alternates)` in its output.)

3. **Open the text in the reader** — web or Android; both read the same API.

4. **Tap a homograph word** and look for the alternates:

   | Surface  | Active (chosen) | Alternate tab(s) shown        |
   |----------|-----------------|-------------------------------|
   | `galera` | galera (loss)   | gale (hunger)                 |
   | `ilaran` | ilara (queue)   | ilar (bean)                   |
   | `ordena` | ordena (order)  | agindu, ordena erlijioso      |

   - **Web reader:** the word popup shows an **"N alternate meanings"**
     disclosure — expand it to see the alternate lemma(s).
   - **Android reader:** the alternates appear as **parse-switcher chips** at the
     top of the word popup; tap a chip to view that lemma's definition.

## Notes

- The seed is idempotent — re-running updates the chosen id + alternates.
- Case doesn't matter (the override match is case-folded), but the word must
  tokenize to the exact surface (`galera`, `ilaran`, `ordena`) for the override
  to fire.
- No override rows have alternates by default, so this feature is dormant until
  something (this seed, or a curator) sets `alternate_lemma_ids`.
