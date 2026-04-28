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

fetch_kaikki_hindi() {
  local out="$DATA_ROOT/kaikki-hindi"
  mkdir -p "$out"
  local url="https://kaikki.org/dictionary/Hindi/kaikki.org-dictionary-Hindi.jsonl"
  echo "[fetch] kaikki-hindi  $url -> $out/raw.jsonl"
  curl --fail --location --output "$out/raw.jsonl" "$url"
  echo "[fetch] kaikki-hindi  done ($(wc -l <"$out/raw.jsonl") lines, $(du -h "$out/raw.jsonl" | cut -f1))"
}

case "${1-all}" in
  all)
    fetch_kaikki_hindi
    ;;
  kaikki-hindi)
    fetch_kaikki_hindi
    ;;
  *)
    echo "unknown source: $1" >&2
    echo "available: kaikki-hindi (more land per per-source PR)" >&2
    exit 1
    ;;
esac
