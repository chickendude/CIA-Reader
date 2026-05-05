#!/usr/bin/env bash
# Fetch upstream dictionary dumps for the registered importers (T-3.10).
#
# The raw artifacts are .gitignored — re-running the appropriate
# `pnpm dictionary:import <source>` after a fetch picks up the new file.
#
# Cache freshness rules (per source):
#   1. No `raw.jsonl`        → fetch.
#   2. mtime < MAX_AGE_DAYS  → skip (offline-friendly fast path; no network).
#   3. mtime ≥ MAX_AGE_DAYS  → ask upstream with `If-Modified-Since`:
#                                 304 → touch local mtime, skip.
#                                 200 → re-download, atomic-rename .tmp → raw.jsonl.
#   --force / FORCE=1        → always download, ignore freshness.
#
# Downloads write to `<source>/raw.jsonl.tmp` first and rename only on
# success, so a stalled transfer never poisons the canonical filename.
#
# Usage:
#   scripts/fetch-dictionary-sources.sh                    # fetch missing or stale (>7d)
#   scripts/fetch-dictionary-sources.sh kaikki-hindi       # one source
#   scripts/fetch-dictionary-sources.sh --force            # always download
#   scripts/fetch-dictionary-sources.sh --max-age 30       # only refresh after 30 days
#   MAX_AGE_DAYS=0 scripts/...                             # always check upstream
set -euo pipefail

cd "$(dirname "$0")/.."
DATA_ROOT="data/dictionaries"
mkdir -p "$DATA_ROOT"

FORCE="${FORCE:-0}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-7}"
ARGS=()
i=0
while (( i < $# )); do
  i=$((i + 1))
  arg="${!i}"
  case "$arg" in
    --force|-f)
      FORCE=1
      ;;
    --max-age)
      i=$((i + 1))
      MAX_AGE_DAYS="${!i:?--max-age needs a number of days}"
      ;;
    --max-age=*)
      MAX_AGE_DAYS="${arg#--max-age=}"
      ;;
    *)
      ARGS+=("$arg")
      ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

# Returns 0 (true) if the file is stale (older than MAX_AGE_DAYS) or missing.
# `find -mtime +N` is portable across BSD (macOS) and GNU find.
is_stale() {
  local path="$1"
  if [[ ! -s "$path" ]]; then return 0; fi
  if (( MAX_AGE_DAYS == 0 )); then return 0; fi
  if [[ -n "$(find "$path" -mtime "+$((MAX_AGE_DAYS - 1))" 2>/dev/null)" ]]; then
    return 0
  fi
  return 1
}

# Download with `--time-cond` so the server can answer 304 Not Modified.
# Curl behaviour with `--time-cond <file>`:
#   - 304 → curl exits 0 and does NOT write to --output.
#   - 200 → curl writes the new body to --output (overwriting any prior .tmp).
# So checking whether .tmp ends up non-empty tells us which path we took.
# Extra curl args (e.g. resume / retry knobs) come in via $3.
download_with_conditional() {
  local label="$1"
  local url="$2"
  local out="$3"
  shift 3
  local extra_args=("$@")

  local time_cond_args=()
  if [[ -s "$out/raw.jsonl" && "$FORCE" != "1" ]]; then
    time_cond_args=(--time-cond "$out/raw.jsonl")
    echo "[fetch] $label  cached but stale, asking upstream If-Modified-Since"
  else
    echo "[fetch] $label  $url -> $out/raw.jsonl"
  fi

  curl --fail --location \
    "${time_cond_args[@]+"${time_cond_args[@]}"}" \
    --output "$out/raw.jsonl.tmp" \
    "${extra_args[@]+"${extra_args[@]}"}" \
    "$url"

  if [[ -s "$out/raw.jsonl.tmp" ]]; then
    mv "$out/raw.jsonl.tmp" "$out/raw.jsonl"
    echo "[fetch] $label  downloaded ($(wc -l <"$out/raw.jsonl") lines, $(du -h "$out/raw.jsonl" | cut -f1))"
  else
    rm -f "$out/raw.jsonl.tmp"
    touch "$out/raw.jsonl"
    echo "[fetch] $label  upstream not modified — refreshed mtime, kept cache"
  fi
}

skip_if_fresh() {
  # $1 = label, $2 = path to raw.jsonl.
  # Returns 0 (skip) only when the file is present AND younger than MAX_AGE_DAYS
  # AND --force was not set. Stale-but-present cache falls through to the
  # conditional-GET path so we can let the server tell us if it's still good.
  if [[ "$FORCE" == "1" ]]; then return 1; fi
  if [[ ! -s "$2" ]]; then return 1; fi
  if is_stale "$2"; then return 1; fi
  echo "[fetch] $1  cached at $2 ($(wc -l <"$2") lines, $(du -h "$2" | cut -f1)) — fresh (<${MAX_AGE_DAYS}d), skipping"
  return 0
}

fetch_kaikki() {
  local lang_slug="$1"   # kebab-case, e.g. kaikki-hindi
  local lang_name="$2"   # capitalized, e.g. Hindi (matches Kaikki's URL)
  local out="$DATA_ROOT/$lang_slug"
  mkdir -p "$out"
  if skip_if_fresh "$lang_slug" "$out/raw.jsonl"; then return; fi
  local url="https://kaikki.org/dictionary/${lang_name}/kaikki.org-dictionary-${lang_name}.jsonl"
  download_with_conditional "$lang_slug" "$url" "$out"
}

fetch_kaikki_en_translations() {
  # The English Wiktionary dump is shared by all three
  # kaikki-en-translations-* importers (HI / MR / OR) — they each
  # filter the same upstream file by lang_code. Big download
  # (~3 GB JSONL) and kaikki.org throttles late in the transfer.
  #
  # Resume isn't safe to combine with `--time-cond` here: if the upstream
  # changed between runs, `--continue-at -` would append to a stale .tmp
  # whose first bytes are from a different version. So for this source we
  # let the conditional-GET decide:
  #   - 304 → keep cached file, skip.
  #   - 200 → fresh download to .tmp (no resume); --speed-time / --speed-limit
  #           keep curl bailing out of stalled transfers so it retries
  #           cleanly via --retry rather than hanging.
  local out="$DATA_ROOT/kaikki-en-translations"
  mkdir -p "$out"
  if skip_if_fresh "kaikki-en-translations" "$out/raw.jsonl"; then return; fi
  local url="https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"
  echo "[fetch] kaikki-en-translations  (large file; --retry handles stalled transfers)"
  download_with_conditional \
    "kaikki-en-translations" "$url" "$out" \
    --retry 10 \
    --retry-delay 5 \
    --retry-all-errors \
    --speed-time 60 \
    --speed-limit 102400
}

fetch_dbnary() {
  # T-3.10b/e: Dbnary publishes per-language Turtle dumps as
  # <lang3>_dbnary_ontolex.ttl.bz2 at the kaiko.getalp.org "latest"
  # path. We download to <slug>/raw.ttl.bz2 and bunzip2 in-place to
  # raw.ttl so the importer (which streams a Turtle file) reads a
  # stable filename. bunzip2 is part of bzip2 — every Linux base
  # image and every modern macOS already has it, so no new system
  # dep here.
  local slug="$1"     # e.g. dbnary-hi
  local lang3="$2"    # ISO 639-3 (hin, mar, …) — Dbnary's URL convention
  local out="$DATA_ROOT/$slug"
  mkdir -p "$out"
  if skip_if_fresh "$slug" "$out/raw.ttl"; then return; fi
  local url="https://kaiko.getalp.org/static/ontolex/latest/${lang3}_dbnary_ontolex.ttl.bz2"
  local bz="$out/raw.ttl.bz2"
  echo "[fetch] $slug  $url -> $bz"
  curl --fail --location \
    --output "${bz}.tmp" \
    --retry 5 --retry-delay 5 --retry-all-errors \
    "$url"
  mv "${bz}.tmp" "$bz"
  echo "[fetch] $slug  decompressing"
  bunzip2 -kf "$bz"
  rm -f "$bz"
  echo "[fetch] $slug  ready ($(wc -l <"$out/raw.ttl") lines, $(du -h "$out/raw.ttl" | cut -f1))"
}

manual_dump_check() {
  # Sources that require registration / manual download (e.g.
  # CFILT WordNets behind a research-use form). Verifies the
  # operator has placed the file at the expected path; if not,
  # prints a one-line pointer to the project README.
  local slug="$1"
  local expected="$2"
  local doc_url="$3"
  local out="$DATA_ROOT/$slug"
  mkdir -p "$out"
  if [[ -s "$out/$expected" ]]; then
    echo "[fetch] $slug  manual artifact present at $out/$expected ($(wc -l <"$out/$expected") lines, $(du -h "$out/$expected" | cut -f1))"
    return
  fi
  echo "[fetch] $slug  requires a manual download — see $doc_url"
  echo "[fetch] $slug  expected file: $out/$expected"
  return 1
}

case "${1-all}" in
  all)
    fetch_kaikki kaikki-hindi Hindi
    fetch_kaikki kaikki-marathi Marathi
    fetch_kaikki kaikki-odia Odia
    fetch_kaikki_en_translations
    fetch_dbnary dbnary-hi hin
    fetch_dbnary dbnary-mr mar
    # `all` skips the registration-gated WordNets so a fresh box
    # boots with what's freely available; trigger them explicitly
    # by name.
    ;;
  kaikki-hindi)
    fetch_kaikki kaikki-hindi Hindi
    ;;
  kaikki-marathi)
    fetch_kaikki kaikki-marathi Marathi
    ;;
  kaikki-odia)
    fetch_kaikki kaikki-odia Odia
    ;;
  kaikki-en-translations)
    fetch_kaikki_en_translations
    ;;
  dbnary-hi)
    fetch_dbnary dbnary-hi hin
    ;;
  dbnary-mr)
    fetch_dbnary dbnary-mr mar
    ;;
  hindi-wordnet)
    manual_dump_check hindi-wordnet synsets.tsv \
      "docs/dictionary-sources.md (Hindi WordNet section) — CFILT IIT-Bombay distribution requires registration"
    ;;
  marathi-wordnet)
    manual_dump_check marathi-wordnet synsets.tsv \
      "docs/dictionary-sources.md (Marathi WordNet section) — CFILT IIT-Bombay distribution requires registration"
    ;;
  molesworth)
    manual_dump_check molesworth dsal.xml \
      "docs/dictionary-sources.md (Molesworth section) — DSAL XML; place dsal.xml at apps/web/data/dictionaries/molesworth/"
    ;;
  odia-wordnet)
    manual_dump_check odia-wordnet synsets.tsv \
      "docs/dictionary-sources.md (Odia WordNet section) — ISI Kolkata distribution requires registration"
    ;;
  odianlp)
    manual_dump_check odianlp curated.jsonl \
      "docs/dictionary-sources.md (OdiaNLP section) — assemble curated.jsonl with per-entry licenses; the importer fails loudly on unrecognized licenses"
    ;;
  *)
    echo "unknown source: $1" >&2
    echo "available: kaikki-hindi, kaikki-marathi, kaikki-odia, kaikki-en-translations, dbnary-hi, dbnary-mr, hindi-wordnet, marathi-wordnet, molesworth, odia-wordnet, odianlp" >&2
    exit 1
    ;;
esac
