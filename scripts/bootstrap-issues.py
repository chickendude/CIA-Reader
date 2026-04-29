#!/usr/bin/env python3
"""
Bootstrap GitHub Issues for CIA Reader.

Creates one "epic" issue per milestone (M0..M13), then creates a child ticket
issue for each ticket (T-x.y) and links it as a sub-issue of its epic.

Requirements:
- `gh` CLI installed and authenticated with repo write access.
- REPO set to the target repo (owner/name).

Usage:
    python3 scripts/bootstrap-issues.py [--dry-run]
"""

import json
import subprocess
import sys
import time

REPO = "chickendude/CIA-Reader"

# ---------------------------------------------------------------------------
# Milestone + ticket data. Kept flat + explicit so it is easy to read/edit.
# ---------------------------------------------------------------------------

MILESTONES = [
    {
        "id": "M0",
        "title": "M0 — Foundations",
        "duration": "~1 week",
        "summary": (
            "Monorepo scaffold, dev Compose, linting/CI, migrations tooling, "
            "smoke test, and the language registry. Gets the skeleton standing."
        ),
        "tickets": [
            ("T-0.1", "Monorepo scaffold",
             "Root with `apps/web` (SvelteKit, TS), `services/nlp` (FastAPI), "
             "`infra/` (Docker Compose, Caddyfile), `packages/shared-types` "
             "(TS + generated types). pnpm workspaces."),
            ("T-0.2", "Local dev Docker Compose",
             "Services for postgres, redis, nlp, web dev server with hot-reload. "
             "`make dev` / `pnpm dev` boots everything."),
            ("T-0.3", "Linting, formatting, CI",
             "ESLint, Prettier, `ruff`+`black`, `pre-commit` hooks. "
             "GitHub Actions workflow running lint + typecheck + unit tests on PR."),
            ("T-0.4", "Postgres migrations tooling",
             "Use drizzle-kit owned by the web app. NLP service reads via a typed "
             "client. Initial empty migration committed."),
            ("T-0.5", "End-to-end smoke",
             "SvelteKit endpoint calls the NLP service and returns a canned "
             "response — proves Docker networking + type sharing work."),
            ("T-0.6", "Language registry",
             "Shared module `packages/shared-types/languages.ts` (mirrored in "
             "Python) with `{ code, displayName, nativeName, script, scriptCode "
             "(ISO 15924), textDirection, supportedRomanizations, "
             "defaultRomanization, recommendedFonts, pipelineId }`. MVP entries: "
             "`hi` (Deva), `mr` (Deva), `or` (Orya). All script-aware code reads "
             "from this registry — nothing hardcodes Devanagari."),
        ],
    },
    {
        "id": "M1",
        "title": "M1 — Auth & user shell",
        "duration": "3–4 days",
        "summary": (
            "Dual auth (cookies + bearer tokens), profile + per-language prefs, "
            "design tokens, responsive shell, onboarding."
        ),
        "tickets": [
            ("T-1.1", "Auth: Lucia + email/password + magic-link + bearer tokens",
             "Email + password with optional magic-link via Resend/Postmark "
             "(Mailpit in dev). Dual auth: (a) session cookies for web; "
             "(b) long-lived refresh + short-lived access bearer tokens via "
             "`POST /api/v1/auth/login` and `POST /api/v1/auth/refresh`. Single "
             "`requireUser(request)` helper used by every endpoint."),
            ("T-1.2", "User profile page",
             "Email, display name, per-language prefs (script preference, "
             "romanization scheme — ISO 15919 / IAST / Hunterian), theme "
             "preference (system / light / dark)."),
            ("T-1.3", "Design tokens + theming",
             "CSS custom properties for color, typography, spacing. Light + dark "
             "palettes. `data-theme` root attribute; stored server-side; respects "
             "`prefers-color-scheme` by default. No hardcoded colors anywhere."),
            ("T-1.4", "Responsive shell",
             "App layout works at 320px width up. Nav collapses to a bottom tab "
             "bar on mobile. Touch-friendly (≥44px targets). Establishes patterns "
             "reused in every later feature."),
            ("T-1.5", "Language selector + onboarding",
             "On first login, user picks initial target language (hi/mr/or) and "
             "baseline (none / beginner / intermediate)."),
        ],
    },
    {
        "id": "M2",
        "title": "M2 — NLP pipeline core",
        "duration": "~3.5 weeks",
        "summary": (
            "FastAPI + Stanza for hi/mr, custom Odia pipeline, romanization, "
            "async job queue, override lookup, golden-file tests."
        ),
        "tickets": [
            ("T-2.1", "FastAPI skeleton",
             "`/health`, `/process` endpoints. Pydantic schemas. Typed HTTP "
             "client in the web app. `/process` accepts a `language` field; "
             "service dispatches via the language registry."),
            ("T-2.2", "Hindi pipeline",
             "Stanza `hi` for tokenization + lemmatization + UD morphology. NFC "
             "normalize input. Return top-K (K=3) lemma candidates with softmax "
             "scores. `is_oov=true` when no dictionary match; `is_ambiguous=true` "
             "when 2nd candidate is within 0.15 of the top."),
            ("T-2.3", "Marathi pipeline",
             "Stanza `mr` + IndicNLP tokenizer as fallback. Same top-K output "
             "contract as Hindi. Real-world accuracy is lower (~75–85%) so "
             "ambiguity/OOV will fire more often — that's OK because M6 carries it."),
            ("T-2.3a", "Odia pipeline (custom)",
             "Stanza's Odia is weak; build our own. IndicNLP tokenizer "
             "(`indic_tokenize.trivial_tokenize(…, lang='or')`). Rule-based "
             "morphological analyzer covering regular verb/noun/adjective "
             "paradigms (~85–90% of inflected forms). Lemma lookup against "
             "seeded Odia WordNet + OdiaNLP data; stem fallback with "
             "`is_oov=true`. Output contract identical to hi/mr. Baseline: "
             "~70–80% lemma accuracy at launch."),
            ("T-2.3b", "Odia golden-file corpus",
             "~100 Odia sentences with gold lemmas/features from Odia Wikipedia, "
             "public-domain literature, and hand-written tricky-paradigm cases. "
             "Eval set for T-2.3a iteration and regression test thereafter."),
            ("T-2.4", "Morphology gloss formatter",
             "Convert UD features to human-readable strings (e.g. \"3sg fem "
             "present habitual of *bolnā*\"). Language-aware templates, not "
             "raw feature dumps."),
            ("T-2.5", "Romanization + transliteration utilities",
             "Wrap `indic-transliteration` in a typed module. Bidirectional: "
             "`toRoman(str, fromScript, toScheme)` and `toNative(str, "
             "targetScript, fromScheme)`. `fromScript` / `targetScript` come "
             "from the language registry. Precompute romanization at token "
             "processing; transliteration-as-you-type via `sanscript.js` "
             "client-side."),
            ("T-2.6", "Async job queue (arq)",
             "NLP service owns its queue via `arq` (Redis). Upload handler "
             "enqueues; worker processes + writes tokens + updates "
             "`texts.status`."),
            ("T-2.7", "Override lookup in the worker",
             "Before accepting Stanza's top candidate, worker checks "
             "`form_lemma_overrides` for `(language, surface_nfc, "
             "context_signature)`. A promoted override wins over Stanza. Single "
             "indexed lookup per token."),
            ("T-2.8", "Golden-file tests",
             "~50 Hindi + ~50 Marathi + ~100 Odia sentences with expected "
             "lemmas/features and known-ambiguous cases. CI enforces ≥90% hi, "
             "≥80% mr, ≥70% or lemma accuracy. CI fails on drift or on "
             "ambiguity-detection regression."),
        ],
    },
    {
        "id": "M3",
        "title": "M3 — Dictionary & translations",
        "duration": "~1.5 weeks",
        "summary": (
            "Open-source dictionary imports, translation API, curator role, "
            "customize flow, browse page, dictionary editor, provenance badges."
        ),
        "tickets": [
            ("T-3.1", "Open-source dictionary imports",
             "Idempotent importers for Hindi (CFILT WordNet + Dbnary + "
             "Shabdanjali), Marathi (WordNet + Molesworth + permissive modern "
             "sources), Odia (Odia WordNet ISI Kolkata + OdiaNLP + any "
             "permissively-licensed Odia-English). Stores `source`, "
             "`source_attribution`, `source_id`. Re-runnable without clobbering "
             "curator-locked lemmas. Licenses logged in "
             "`docs/dictionary-sources.md`. Flag Odia as `coverage: sparse` on "
             "the browse page."),
            ("T-3.2", "Translation submission API",
             "`POST /api/v1/translations` with body, `parent_translation_id`, "
             "`lemma_id`. Rate-limited per user."),
            ("T-3.3", "Translation retrieval",
             "`GET /api/v1/lemmas/:id/translations` — officials first (stable "
             "order), then community translations ordered by votes."),
            ("T-3.4", "Curator role + permissions",
             "`role=curator` can edit lemmas/translations in their language(s); "
             "`role=admin` can do everything + promote curators. All edits "
             "logged to `lemma_edit_history`."),
            ("T-3.5", "User customize flow",
             "Logged-in user viewing an official translation can click "
             "**Customize** → personal copy with `parent_translation_id`, "
             "editable only by them. Shown at the top of their pop-up."),
            ("T-3.6", "Dictionary browse page",
             "Public per-language lemma browsing with search accepting native "
             "script or any supported romanization (via `<ScriptAwareInput>`), "
             "filters (POS, frequency rank, has-official-translation, "
             "has-audio-example), paginated index. Good for SEO."),
            ("T-3.7", "Curator dictionary editor",
             "`/moderation/dictionary`. Search/browse lemmas via "
             "`<ScriptAwareInput>`. Editable: headword, POS, frequency rank, "
             "gloss, aliases. Translations editor: reorder, mark official, "
             "edit, soft-hide. **Merge lemmas** (rewires tokens/translations/"
             "known-lemmas/overrides, soft-deletes loser, diff in "
             "`lemma_edit_history`). **Split lemma** (reverse of merge). "
             "**Accept from queue** (promotes a `lemma_proposals` row). "
             "Every change writes `lemma_edit_history` with a required reason."),
            ("T-3.8", "Translation provenance badges",
             "Small icon on each translation in the reader pop-up showing "
             "whether it came from (a) imported dictionary (with source name), "
             "(b) curator, (c) community, (d) user's own customization."),
            ("T-3.9", "Bulk curator tools",
             "CSV import for curator-written translations. Bulk-promote "
             "community translations matching a query. Bulk-attribution update "
             "on re-import."),
        ],
    },
    {
        "id": "M4",
        "title": "M4 — Text upload & processing",
        "duration": "4–5 days",
        "summary": (
            "Upload UI (paste + .txt + EPUB), chunking, async processing, "
            "library page, authorization middleware."
        ),
        "tickets": [
            ("T-4.1", "Upload UI",
             "Paste box (with language dropdown) + file drop-zone for `.txt` "
             "and `.epub`. Preview + title confirmation. Texts default to "
             "`visibility='private'`."),
            ("T-4.2", "`.txt` ingest",
             "Enforce UTF-8, NFC normalize. Under threshold (~50k tokens) → "
             "single chapter. Above → auto-split at paragraph boundaries. "
             "Explicit user delimiters (form-feed, `---`) override."),
            ("T-4.3", "EPUB ingest",
             "`epub2` (Node) or `epub.js` to extract (chapter title, chapter "
             "html). Strip HTML preserving paragraph breaks. Chapter structure "
             "preserved as-is."),
            ("T-4.4", "Upload → enqueue → status UI",
             "Enqueue NLP job, show \"processing\" status with progress bar "
             "(poll or SSE). On completion, redirect to the reader."),
            ("T-4.5", "Library page",
             "Three tabs: **Your texts**, **Shared with you**, **Official**. "
             "Each card: status badge, title, language, last-read position, "
             "% read, visibility badge."),
            ("T-4.6", "Authorization middleware",
             "Central server-side `assertCanRead(user, text)` that checks "
             "ownership, `text_shares`, `text_group_shares`, or "
             "`visibility='official'`. Used by every reader / stats / progress "
             "endpoint. Deny-by-default."),
        ],
    },
    {
        "id": "M5",
        "title": "M5 — Reader UI",
        "duration": "~1.5 weeks",
        "summary": (
            "Three reading modes, reader settings, mobile ergonomics, token "
            "rendering, romanization layer, word pop-up, OOV rendering, "
            "known-words updates, progress tracking, shortcuts."
        ),
        "tickets": [
            ("T-5.1", "Reader page skeleton + three reading modes",
             "URL encodes `(text_id, chapter_idx, token_idx)`. Three layout "
             "modes: **`page`** (pagination with swipe), **`paged-scroll`** "
             "(fixed word-count per page, vertical scroll within), "
             "**`continuous`** (one page, virtual-scrolled). Shared token "
             "rendering + pop-up logic across all three."),
            ("T-5.1a", "Book chunking for performance",
             "`text_chapters` is the natural unit: EPUB chapters preserved, "
             ".txt/paste auto-split above threshold. Reader loads one chapter "
             "at a time; `continuous` chains chapters with lazy prefetch on "
             "scroll-near-end."),
            ("T-5.1b", "Reader-mode settings UI",
             "Settings gear opens: reading layout mode, words-per-page for "
             "`paged-scroll`, **font family** (shortlist driven by language "
             "registry `recommendedFonts` — Devanagari vs Odia vs future "
             "scripts; lazy-loaded per script), font size (14–28pt), line "
             "spacing (1.2–2.2), reading width (narrow/medium/wide), "
             "romanization toggle + scheme, highlight style. Live preview. "
             "Writes through to `user_languages`."),
            ("T-5.1c", "Mobile reader ergonomics",
             "Swipe left/right in `page` mode. Long-press as alternative to "
             "tap for pop-up. Reader toolbar is a collapsible bottom sheet on "
             "small viewports. Pop-up repositions to avoid the soft keyboard "
             "and viewport edges."),
            ("T-5.2", "Token rendering",
             "Each word as `<span data-token-id>` with a class reflecting "
             "known-status (`unknown|learning|known|ignored`). Unknown words "
             "highlighted LingQ-style (blue/yellow), configurable."),
            ("T-5.3", "Optional inline romanization",
             "Toggle renders small romanized text above/beside each word using "
             "the precomputed romanization on `text_tokens`."),
            ("T-5.4", "Word pop-up component",
             "Opens on click/tap. Shows: surface form, romanization, headword + "
             "POS, morphology gloss, translations (personal → officials → "
             "community), status buttons (Learning / Known / Ignored), and an "
             "\"N possible meanings\" chevron when `is_ambiguous=true` that "
             "expands to list candidate lemmas with their glosses and a \"This "
             "one\" button."),
            ("T-5.4a", "OOV rendering",
             "Tokens with `is_oov=true` render in a distinct visual state "
             "(dashed underline). Pop-up shows \"No dictionary match\" plus "
             "the correction options from T-6.2."),
            ("T-5.5", "Client-side known-words state",
             "Optimistic updates; write-through to "
             "`PATCH /api/known-lemmas`. Server recomputes per-language "
             "known-count cache."),
            ("T-5.6", "Reading progress",
             "Debounced `PATCH /api/text-progress` as user scrolls/paginates."),
            ("T-5.6a", "First-visible-word progress anchors",
             "Persist progress as the first visible word in `page`, "
             "`paged-scroll`, and `continuous` modes. Switching modes "
             "flushes and carries the current `chapter` + `token` anchor "
             "so readers resume at the same visible word."),
            ("T-5.7", "Keyboard shortcuts",
             "`k`=known, `l`=learning, `i`=ignore, `→/←`=next/prev word."),
        ],
    },
    {
        "id": "M6",
        "title": "M6 — Disambiguation & corrections",
        "duration": "~1 week",
        "summary": (
            "Silent per-user fix vs explicit report. Script-agnostic dictionary "
            "search, new-lemma proposals, apply-to-all, curator moderation, "
            "crowdsourced aggregation, override consultation, correction stats."
        ),
        "tickets": [
            ("T-6.1", "Alternate-meanings UI in pop-up",
             "When `is_ambiguous=true`, chevron below primary lemma expands an "
             "inline list of candidates from `lemma_candidates_json`. Each "
             "entry: headword, POS, morphology gloss, short translation "
             "preview. \"This one\" writes `token_corrections` "
             "(`pick_candidate`) and updates the displayed lemma for that user."),
            ("T-6.2", "Wrong-word correction modal",
             "Every pop-up gets a \"Fix\" affordance. Modal shows: (a) "
             "candidate list; (b) **script-agnostic dictionary search** over "
             "lemmas — user types in native script or any supported "
             "romanization, live transliteration via `indic-transliteration`, "
             "fuzzy match against `lemmas.headword`, POS + gloss in dropdown, "
             "inline script switcher; (c) \"Add new word\" (opens T-6.3); "
             "(d) \"Mark as proper noun\" / \"Foreign / code-switched\" / "
             "\"Not a word.\" Footer has \"Also report to moderators\" "
             "checkbox — default OFF for pick_candidate, ON for manual_lemma "
             "and new_lemma."),
            ("T-6.2a", "Shared `<ScriptAwareInput>` component",
             "Props: `language`, `initialScript` (auto|native|romanization), "
             "`onNativeChange(nfcString)`. Handles keystroke-by-keystroke "
             "transliteration, IME-friendly composition, paste detection "
             "(paste of native skips transliteration + NFC-normalizes), "
             "\"show as\" toggle. Used by T-6.2, T-6.3, T-3.7, and anywhere "
             "else native-script input is needed. Works for Devanagari AND "
             "Odia AND future scripts — driven by the language registry."),
            ("T-6.2b", "Apply-to-all follow-up toast",
             "After committing a correction, toast offers: **Apply everywhere "
             "(same context)** (uses `context_signature_fuzzy`), **Apply "
             "everywhere (all contexts)**, **Just this one**. Reverse "
             "sanity check when correcting against a lemma that has other "
             "plausible alternatives (by frequency + form-frequency). "
             "Dismissible."),
            ("T-6.3", "New-lemma submission form",
             "Invoked from T-6.2. Fields: headword (native script, via "
             "`<ScriptAwareInput>`), POS, short gloss, optional notes. Creates "
             "`lemma_proposals` (pending), `token_corrections` (new_lemma), "
             "and auto-files `parse_reports`. Proposer sees the new lemma "
             "immediately; curator acceptance promotes to global `lemmas`."),
            ("T-6.4", "Per-user correction applied at read time",
             "Reader loader joins `text_tokens` with `token_corrections WHERE "
             "user_id = :me`. Corrections are lemma-scoped: marking token as "
             "lemma X updates that user's `user_known_lemmas` for X."),
            ("T-6.5", "`parse_reports` table + duplicate merging",
             "Schema: id, token_id, language, surface_nfc, original_candidates, "
             "corrected_lemma_id, correction_type, reporter_id, note, status, "
             "assigned_reviewer_id, resolved_at, resolution_note, "
             "duplicate_count. Indexed on `(language, status)`. New reports "
             "matching an open report on `(language, surface_nfc, "
             "context_signature, corrected_lemma_id)` increment "
             "`duplicate_count`."),
            ("T-6.6", "Curator moderation UI for parse reports",
             "`/moderation/parses`. Left pane: filterable list (language, "
             "status, report count, date). Right pane: surrounding sentence "
             "with token highlighted, original top-K vs proposed correction "
             "side-by-side, reporter's note + duplicate count + independent "
             "corroborations. Actions: **Accept for everyone** (promotes to "
             "`form_lemma_overrides`), **Accept + fix dictionary** (opens "
             "editor in side sheet), **Reject** (required reason), **Mark "
             "duplicate of…**, **Defer**. Resolution note required."),
            ("T-6.7", "Crowdsourced aggregation worker",
             "Scheduled `arq` cron scans recent `token_corrections` grouped by "
             "`(language, surface_nfc, context_signature, chosen_lemma_id)`. "
             "Group with ≥K distinct users (K=5) and ≥70% majority → "
             "writes/updates `form_lemma_overrides` AND auto-files a "
             "`parse_reports` (status=triaged) for curator sanity-check. "
             "Curators in T-6.6 promote or veto."),
            ("T-6.8", "Admin reprocess-text endpoint",
             "`POST /api/v1/admin/reprocess-text/:id` re-runs the NLP pipeline "
             "against already-ingested texts after a large batch of dictionary "
             "/ override updates. (T-2.7 handles the actual override lookup "
             "in-worker.)"),
            ("T-6.9", "Correction-quality stats dashboard",
             "Lightweight admin view: per-language real-world lemma accuracy "
             "(estimated from correction rate), top reported surfaces, backlog "
             "size, median time-to-resolution. Tracked over time to verify "
             "model updates + overrides + dictionary expansions actually help."),
        ],
    },
    {
        "id": "M7",
        "title": "M7 — Sharing, groups & official library",
        "duration": "~1 week",
        "summary": (
            "Visibility controls, per-user + group sharing, classroom teacher "
            "dashboard, public official library."
        ),
        "tickets": [
            ("T-7.1", "Text visibility controls",
             "Owner sees three options on the text settings page: private / "
             "shared / make-official proposal. \"Make official\" lands in a "
             "curator queue — only curators/admins actually set "
             "`visibility='official'`."),
            ("T-7.2", "Share-with-individual flow",
             "Owner enters friend's email/username; creates `text_shares`. "
             "If email isn't registered, held as pending invite keyed to that "
             "email; resolved on signup."),
            ("T-7.3", "Groups management",
             "Create group, invite members by email/username, designate other "
             "owners. Group pages show members + shared texts."),
            ("T-7.4", "Share-with-group flow",
             "Owner picks one of their groups and shares → `text_group_shares`. "
             "All current + future members see it automatically (membership is "
             "the grant)."),
            ("T-7.5", "\"Shared with you\" library tab",
             "Shows shared-in texts with who shared them and via which group. "
             "Opens in reader like an owned text; read-only for non-owners; "
             "per-user progress + known-words still tracked."),
            ("T-7.6", "Official library page",
             "Public, unauthenticated-accessible, all `visibility='official'` "
             "texts by language. SSR for SEO. Used as marketing surface."),
            ("T-7.7", "Per-user progress on shared/official texts",
             "`user_text_progress` and `user_known_lemmas` are already "
             "user-scoped. Integration test: teacher + 3 students with "
             "independent progress against the same shared text."),
            ("T-7.8", "Classroom teacher dashboard (MVP)",
             "For any group a user owns, show a roster with each member's "
             "known-words count for shared texts and overall reading % across "
             "shared texts. No per-word tracking — aggregate only. Full "
             "analytics is post-MVP."),
        ],
    },
    {
        "id": "M8",
        "title": "M8 — Collections: chapter books & courses",
        "duration": "4–5 days",
        "summary": (
            "Collections layer above individual texts. Create, detail, reader "
            "awareness, collection sharing, library tab, course-specific "
            "affordances."
        ),
        "tickets": [
            ("T-8.1", "Create-collection UI",
             "Name, language, `kind` (`chapter_book` / `course` / `anthology`), "
             "description, cover image. Add texts (existing or new) + reorder "
             "via drag-and-drop. All texts in a collection share the same "
             "language."),
            ("T-8.2", "Collection detail page",
             "Ordered list of member texts with per-text status, aggregated "
             "progress bar, estimated-known-words across all members."),
            ("T-8.3", "Reader next/prev-text awareness",
             "When reading a text that's in a collection, toolbar shows the "
             "collection title and exposes prev/next text navigation."),
            ("T-8.4", "Collection-level sharing",
             "Reuses M7 sharing UI. Sharing a collection grants read on all "
             "member texts; adding a text after the fact propagates to all "
             "sharees (membership = grant)."),
            ("T-8.5", "Collection library tab",
             "Additional view alongside individual texts. Official collections "
             "form the curated starter corpus."),
            ("T-8.6", "Course-specific affordances",
             "`kind='course'`: stricter ordering (\"next\" disabled until "
             "prior is finished, overridable); completion stats badge (no "
             "formal credentialing)."),
        ],
    },
    {
        "id": "M9",
        "title": "M9 — Audio-synced reading",
        "duration": "~1.5 weeks",
        "summary": (
            "Attach audio to texts/chapters, karaoke-style per-word "
            "highlighting, tap-to-seek, manual alignment editor, import/export "
            "of alignment data."
        ),
        "tickets": [
            ("T-9.1", "Audio data model + storage",
             "Object storage for blobs (local volume in dev; Hetzner Object "
             "Storage in prod). `audio_files` table. Upload endpoint accepting "
             "MP3/M4A/OGG up to N MB."),
            ("T-9.2", "Audio player component",
             "`<audio>` with custom transport (play/pause, seek, speed "
             "0.5×–2×). Current playback time emits events the reader "
             "subscribes to."),
            ("T-9.3", "Alignment-driven highlighting",
             "Reader subscribes to timeupdate, looks up `audio_alignments` "
             "containing current time, adds `.playing` class to the matching "
             "`<span data-token-id>`. Smooth-scrolls to keep current word in "
             "view. Works in all three reading modes."),
            ("T-9.4", "Tap-to-seek",
             "Tapping any word while audio is loaded seeks to that word's "
             "`start_ms`. Pop-up remains openable during playback (auto-pauses)."),
            ("T-9.5", "Manual alignment editor (no Whisper yet)",
             "Per-chapter page; text shown one sentence at a time; owner "
             "press-and-holds during playback to record start/end per "
             "sentence; token-level timing linearly interpolated across words "
             "within a sentence. How official audio gets added pre-Whisper."),
            ("T-9.6", "Import/export of alignment data",
             "JSON format compatible with Whisper word-timestamps / WebVTT "
             "per-word cues. Lets us import pre-aligned audio without the "
             "manual editor."),
            ("T-9.7", "Audio source attribution + licensing checkbox",
             "Owner confirms redistribution rights on upload. Official audio "
             "carries explicit attribution shown in the player."),
        ],
    },
    {
        "id": "M10",
        "title": "M10 — Learning stats & quality-of-life",
        "duration": "3–4 days",
        "summary": (
            "Per-language stats, estimated comprehension on library cards, "
            "vocabulary export, translation voting, listening stats."
        ),
        "tickets": [
            ("T-10.1", "Per-language stats page",
             "Known / learning counts (over lemmas), total lemmas encountered, "
             "unique lemmas per text, estimated comprehension % per text and "
             "collection."),
            ("T-10.2", "Estimated-known % on cards",
             "Library + collection cards show % of lemmas the user has marked "
             "known in the text(s). Computed server-side; cached."),
            ("T-10.3", "Vocabulary export",
             "CSV with `headword, pos, gloss, status` per language. Useful for "
             "Anki."),
            ("T-10.4", "Translation voting UI + `translation_votes`",
             "Officials unaffected by votes; votes only reorder community "
             "translations."),
            ("T-10.5", "Listening stats",
             "Minutes listened per language / text / collection, powered by "
             "the audio player's playback-time events."),
        ],
    },
    {
        "id": "M11",
        "title": "M11 — Moderation, reports, polish",
        "duration": "3–4 days",
        "summary": (
            "Translation flagging, rate limits, error/empty states, "
            "accessibility pass, cross-browser + mobile QA."
        ),
        "tickets": [
            ("T-11.1", "Flag/report flow on translations",
             "Admin panel lists reports. Admins can hide a translation "
             "(`hidden=true`) or promote a user to curator."),
            ("T-11.2", "Basic rate limits",
             "Uploads per day per user, translation submissions per hour, "
             "corrections per hour, audio upload size caps."),
            ("T-11.3", "Error + empty states",
             "Throughout the app. \"NLP job failed\" / \"audio failed to "
             "load\" surfaced with retry buttons."),
            ("T-11.4", "Accessibility pass",
             "Keyboard nav in reader, ARIA for pop-ups, color-contrast check "
             "on highlight modes, focus management in pop-up + share/group "
             "modals, audio player keyboard controls."),
            ("T-11.5", "Cross-browser + mobile QA pass",
             "iOS Safari, Android Chrome, desktop Firefox/Chrome/Safari. "
             "Touch, swipe, long-press, and audio (including background on "
             "mobile) verified."),
        ],
    },
    {
        "id": "M12",
        "title": "M12 — API hardening & mobile-readiness",
        "duration": "4–5 days",
        "summary": (
            "OpenAPI spec, versioning policy, API keys, per-token rate limits, "
            "payload audit, contract tests, client docs."
        ),
        "tickets": [
            ("T-12.1", "OpenAPI 3.1 spec + docs UI",
             "Auto-generated from SvelteKit API routes (Zod→OpenAPI) + FastAPI. "
             "Published at `/api/docs` (Scalar or Swagger UI). CI fails if a "
             "route lacks a documented schema."),
            ("T-12.2", "API versioning policy",
             "Only `/api/v1/*` is stable. Breaking changes → `/api/v2/*`. "
             "Deprecated v1 endpoint supported ≥6 months after v2 ships. "
             "`API-Deprecation` response header on deprecated routes."),
            ("T-12.3", "Personal API keys",
             "Logged-in users can generate keys from their profile (scoped to "
             "their own account, separate from web bearer tokens). For future "
             "mobile + third-party. Revocable, stored hashed."),
            ("T-12.4", "Per-token rate limiting",
             "Extend M11 limits to per-API-key and per-device. Surfaced in "
             "headers (`X-RateLimit-Remaining`, `Retry-After`)."),
            ("T-12.5", "Mobile-friendly payload shapes audit",
             "Read endpoints (reader loader, stats, library) audited for "
             "over-fetching. Any response >100KB gets pagination or "
             "field-selection. Reader chapter payload specifically verified "
             "lean for cellular."),
            ("T-12.6", "Contract tests",
             "Freeze v1 JSON shapes for key endpoints. Any unintentional shape "
             "change breaks CI."),
            ("T-12.7", "Client reference docs",
             "`/docs/api/` — auth flow, token refresh, error envelope, "
             "pagination conventions. What a future mobile dev reads day one."),
        ],
    },
    {
        "id": "M13",
        "title": "M13 — Deployment",
        "duration": "2–3 days",
        "summary": (
            "Production Compose on Hetzner, Caddy + auto-TLS, nightly backups, "
            "deploy script, monitoring-lite."
        ),
        "tickets": [
            ("T-13.1", "Production docker-compose on Hetzner",
             "Services: `web`, `nlp`, `postgres`, `redis`, `caddy`. Resource "
             "limits tuned for CX/CCX instance. Object storage mounted (or "
             "remote via S3-compatible API for Hetzner Object Storage)."),
            ("T-13.2", "Caddyfile + auto-TLS",
             "`ciareader.<domain>` and `api.ciareader.<domain>` (API on a "
             "dedicated subdomain for CORS scoping + separate caching). HTTP/2 "
             "+ brotli on. Range requests for audio streaming."),
            ("T-13.3", "Nightly backups",
             "`pg_dump` to Hetzner Storage Box or B2 nightly. Audio blob "
             "backups weekly. Test restore once."),
            ("T-13.4", "Deploy script",
             "`ssh + git pull + docker compose up -d --build` or a thin GitHub "
             "Actions runner pushing images to GHCR."),
            ("T-13.5", "Monitoring-lite",
             "`/healthz` on both services. Uptime-kuma in Compose. Log "
             "rotation. Defer heavy observability until there's real traffic."),
        ],
    },
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DRY_RUN = "--dry-run" in sys.argv


def gh(*args, capture=True):
    """Run `gh` with args. Returns stdout text (or prints command in dry-run)."""
    cmd = ["gh", *args]
    if DRY_RUN:
        print("[dry-run]", " ".join(repr(a) if " " in a else a for a in cmd))
        return ""
    result = subprocess.run(
        cmd,
        check=True,
        text=True,
        capture_output=capture,
    )
    return result.stdout


def create_label(name, color, description):
    """Create a label, ignore error if it already exists."""
    if DRY_RUN:
        print(f"[dry-run] create label {name} ({color}) — {description}")
        return
    try:
        subprocess.run(
            [
                "gh", "label", "create", name,
                "--repo", REPO,
                "--color", color,
                "--description", description,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        print(f"  label created: {name}")
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").lower()
        if "already exists" in stderr:
            print(f"  label exists: {name}")
        else:
            raise


def create_issue(title, body, labels):
    """Create an issue and return its number."""
    if DRY_RUN:
        print(f"[dry-run] create issue: {title}  labels={labels}")
        return 0
    args = [
        "issue", "create",
        "--repo", REPO,
        "--title", title,
        "--body", body,
    ]
    for label in labels:
        args += ["--label", label]
    url = gh(*args).strip()
    # URL form: https://github.com/owner/repo/issues/123
    number = int(url.rsplit("/", 1)[-1])
    return number


def get_issue_id(number):
    """Resolve a numeric issue # to its GraphQL node_id (needed by sub_issues API)."""
    if DRY_RUN:
        return f"<id-of-#{number}>"
    out = gh(
        "api",
        f"/repos/{REPO}/issues/{number}",
        "--jq", ".id",
    )
    return out.strip()


def link_sub_issue(parent_number, child_number):
    """Link child as a sub-issue of parent via the REST sub_issues endpoint."""
    if DRY_RUN:
        print(f"[dry-run] link #{child_number} as sub-issue of #{parent_number}")
        return
    child_id = get_issue_id(child_number)
    subprocess.run(
        [
            "gh", "api",
            "-X", "POST",
            f"/repos/{REPO}/issues/{parent_number}/sub_issues",
            "-H", "Accept: application/vnd.github+json",
            "-F", f"sub_issue_id={child_id}",
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def epic_body(milestone):
    lines = [
        f"**Duration:** {milestone['duration']}",
        "",
        milestone["summary"],
        "",
        "## Tickets",
        "",
    ]
    for tid, ttitle, _ in milestone["tickets"]:
        lines.append(f"- [ ] {tid} — {ttitle}")
    return "\n".join(lines)


def ticket_body(milestone, ticket_id, ticket_title, ticket_description):
    return (
        f"**Milestone:** {milestone['id']} — {milestone['title'].split(' — ', 1)[-1]}\n\n"
        f"{ticket_description}\n"
    )


def main():
    print(f"Repo: {REPO}")
    print(f"Dry run: {DRY_RUN}")
    print()

    # 1) Labels
    print("== Creating labels ==")
    create_label("epic", "A100FF", "A milestone-level epic with child tickets")
    for m in MILESTONES:
        create_label(
            f"milestone:{m['id']}",
            "0E8A16",
            f"Part of milestone {m['id']}",
        )
    print()

    # 2) Epics + sub-issues
    print("== Creating epics and sub-issues ==")
    for m in MILESTONES:
        print(f"\n-- {m['title']} --")
        epic_title = f"Epic: {m['title']}"
        epic_labels = ["epic", f"milestone:{m['id']}"]
        epic_number = create_issue(epic_title, epic_body(m), epic_labels)
        print(f"  epic #{epic_number}: {epic_title}")

        for tid, ttitle, tdesc in m["tickets"]:
            full_title = f"{tid} — {ttitle}"
            child_number = create_issue(
                full_title,
                ticket_body(m, tid, ttitle, tdesc),
                [f"milestone:{m['id']}"],
            )
            print(f"    child #{child_number}: {full_title}")
            link_sub_issue(epic_number, child_number)
            # Light pacing so we don't trip secondary rate limits.
            if not DRY_RUN:
                time.sleep(0.2)

    print("\nDone.")


if __name__ == "__main__":
    main()
