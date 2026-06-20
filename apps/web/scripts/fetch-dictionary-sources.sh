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

case "${1-all}" in
  all)
    fetch_kaikki kaikki-hindi Hindi
    fetch_kaikki kaikki-marathi Marathi
    fetch_kaikki kaikki-odia Odia
    fetch_kaikki kaikki-yiddish Yiddish
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
  kaikki-yiddish)
    fetch_kaikki kaikki-yiddish Yiddish
    ;;
  kaikki-en-translations)
    fetch_kaikki_en_translations
    ;;
  # Hebrew + Aramaic are NOT dictionary import sources — we never put them
  # in the Yiddish lemma table. They are detection aids for the Yiddish
  # loshn-koydesh romanization generator (services/nlp/scripts/
  # build_loshn_koydesh.py): a Yiddish word whose consonantal skeleton
  # matches a Hebrew/Aramaic headword is a loshn-koydesh loan whose
  # rule-based romanization should defer to the curated reading. Excluded
  # from `all` for that reason; fetch explicitly before regenerating.
  loshn-koydesh-aids)
    fetch_kaikki kaikki-hebrew Hebrew
    fetch_kaikki kaikki-aramaic Aramaic
    ;;
  kaikki-hebrew)
    fetch_kaikki kaikki-hebrew Hebrew
    ;;
  kaikki-aramaic)
    fetch_kaikki kaikki-aramaic Aramaic
    ;;
  *)
    echo "unknown source: $1" >&2
    echo "available: kaikki-hindi, kaikki-marathi, kaikki-odia, kaikki-yiddish, kaikki-en-translations" >&2
    echo "  loshn-koydesh detection aids (not imported): kaikki-hebrew, kaikki-aramaic, loshn-koydesh-aids" >&2
    exit 1
    ;;
esac
