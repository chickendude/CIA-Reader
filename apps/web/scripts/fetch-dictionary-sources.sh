#!/usr/bin/env bash
# Fetch upstream dictionary dumps for the registered importers (T-3.10).
#
# The raw artifacts are .gitignored — re-running the appropriate
# `pnpm dictionary:import <source>` after a fetch picks up the new file.
#
# Usage:
#   scripts/fetch-dictionary-sources.sh           # fetch every source
#   scripts/fetch-dictionary-sources.sh kaikki-hindi
set -euo pipefail

cd "$(dirname "$0")/.."
DATA_ROOT="data/dictionaries"
mkdir -p "$DATA_ROOT"

fetch_kaikki() {
  local lang_slug="$1"   # kebab-case, e.g. kaikki-hindi
  local lang_name="$2"   # capitalized, e.g. Hindi (matches Kaikki's URL)
  local out="$DATA_ROOT/$lang_slug"
  mkdir -p "$out"
  local url="https://kaikki.org/dictionary/${lang_name}/kaikki.org-dictionary-${lang_name}.jsonl"
  echo "[fetch] $lang_slug  $url -> $out/raw.jsonl"
  curl --fail --location --output "$out/raw.jsonl" "$url"
  echo "[fetch] $lang_slug  done ($(wc -l <"$out/raw.jsonl") lines, $(du -h "$out/raw.jsonl" | cut -f1))"
}

fetch_kaikki_en_translations() {
  # The English Wiktionary dump is shared by all three
  # kaikki-en-translations-* importers (HI / MR / OR) — they each
  # filter the same upstream file by lang_code. Big download
  # (~3 GB JSONL) and kaikki.org throttles late in the transfer, so
  # we use --continue-at - to resume on retry and --speed-time /
  # --speed-limit to bail+retry when the stream stalls instead of
  # hanging for hours.
  local out="$DATA_ROOT/kaikki-en-translations"
  mkdir -p "$out"
  local url="https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"
  echo "[fetch] kaikki-en-translations  $url -> $out/raw.jsonl"
  echo "[fetch] kaikki-en-translations  (large file; resume-safe via --continue-at -)"
  curl \
    --fail \
    --location \
    --output "$out/raw.jsonl" \
    --continue-at - \
    --retry 10 \
    --retry-delay 5 \
    --retry-all-errors \
    --speed-time 60 \
    --speed-limit 102400 \
    "$url"
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
