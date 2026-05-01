#!/usr/bin/env bash
# Fetch upstream dictionary dumps for the registered importers (T-3.10).
#
# The raw artifacts are .gitignored — re-running the appropriate
# `pnpm dictionary:import <source>` after a fetch picks up the new file.
#
# Idempotent: a source whose `raw.jsonl` already exists is skipped. Pass
# --force (or set FORCE=1) to re-download and overwrite. Downloads land
# in `<source>/raw.jsonl.tmp` first and are atomically renamed only on
# success, so a stalled transfer never leaves a half-file masquerading
# as cached.
#
# Usage:
#   scripts/fetch-dictionary-sources.sh                    # fetch missing sources
#   scripts/fetch-dictionary-sources.sh kaikki-hindi       # fetch one (if missing)
#   scripts/fetch-dictionary-sources.sh --force            # re-fetch every source
#   scripts/fetch-dictionary-sources.sh --force kaikki-hindi
set -euo pipefail

cd "$(dirname "$0")/.."
DATA_ROOT="data/dictionaries"
mkdir -p "$DATA_ROOT"

FORCE="${FORCE:-0}"
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    *)          ARGS+=("$arg") ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

skip_if_cached() {
  # $1 = label, $2 = path to raw.jsonl.
  # Returns 0 (skip) if the final file already exists and we're not forcing.
  if [[ -s "$2" && "$FORCE" != "1" ]]; then
    echo "[fetch] $1  cached at $2 ($(wc -l <"$2") lines, $(du -h "$2" | cut -f1)) — skipping (--force to re-download)"
    return 0
  fi
  return 1
}

fetch_kaikki() {
  local lang_slug="$1"   # kebab-case, e.g. kaikki-hindi
  local lang_name="$2"   # capitalized, e.g. Hindi (matches Kaikki's URL)
  local out="$DATA_ROOT/$lang_slug"
  mkdir -p "$out"
  if skip_if_cached "$lang_slug" "$out/raw.jsonl"; then return; fi
  local url="https://kaikki.org/dictionary/${lang_name}/kaikki.org-dictionary-${lang_name}.jsonl"
  echo "[fetch] $lang_slug  $url -> $out/raw.jsonl"
  curl --fail --location --output "$out/raw.jsonl.tmp" "$url"
  mv "$out/raw.jsonl.tmp" "$out/raw.jsonl"
  echo "[fetch] $lang_slug  done ($(wc -l <"$out/raw.jsonl") lines, $(du -h "$out/raw.jsonl" | cut -f1))"
}

fetch_kaikki_en_translations() {
  # The English Wiktionary dump is shared by all three
  # kaikki-en-translations-* importers (HI / MR / OR) — they each
  # filter the same upstream file by lang_code. Big download
  # (~3 GB JSONL) and kaikki.org throttles late in the transfer, so
  # we use --continue-at - to resume on retry and --speed-time /
  # --speed-limit to bail+retry when the stream stalls instead of
  # hanging for hours. The .tmp suffix lets `--continue-at -` resume
  # an interrupted run without colliding with a previously-completed
  # raw.jsonl.
  local out="$DATA_ROOT/kaikki-en-translations"
  mkdir -p "$out"
  if skip_if_cached "kaikki-en-translations" "$out/raw.jsonl"; then return; fi
  local url="https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"
  echo "[fetch] kaikki-en-translations  $url -> $out/raw.jsonl"
  echo "[fetch] kaikki-en-translations  (large file; resume-safe via --continue-at -)"
  curl \
    --fail \
    --location \
    --output "$out/raw.jsonl.tmp" \
    --continue-at - \
    --retry 10 \
    --retry-delay 5 \
    --retry-all-errors \
    --speed-time 60 \
    --speed-limit 102400 \
    "$url"
  mv "$out/raw.jsonl.tmp" "$out/raw.jsonl"
  echo "[fetch] kaikki-en-translations  done ($(wc -l <"$out/raw.jsonl") lines, $(du -h "$out/raw.jsonl" | cut -f1))"
}

case "${1-all}" in
  all)
    fetch_kaikki kaikki-hindi Hindi
    fetch_kaikki kaikki-marathi Marathi
    fetch_kaikki kaikki-odia Odia
    fetch_kaikki_en_translations
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
  *)
    echo "unknown source: $1" >&2
    echo "available: kaikki-hindi, kaikki-marathi, kaikki-odia, kaikki-en-translations" >&2
    exit 1
    ;;
esac
