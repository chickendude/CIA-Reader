"""Rule-based phrase detector (T-14.5).

Sits on top of an existing :class:`app.pipelines.base.PipelineResult`
— the Stanza output already carries POS tags, lemmas, and
morphology features per token. The detector matches per-language
YAML patterns against those tokens and emits
:class:`app.schemas.ProposedPhrase` rows; the web worker (T-14.5a
follow-up) persists them to ``phrase_proposals`` and a periodic
promotion pass moves them into ``phrases`` (``source='nlp'``) once
each surface has occurred in ≥ N chapters across the corpus.

Patterns ship as YAML so curators can extend without redeploying
the Python service. See :mod:`.base` for the loader + match logic
and :mod:`.patterns` for the per-language seed files.

The :func:`get_detector` registry lazy-loads each language's
patterns on first use and caches the result for subsequent calls,
so there's no per-request YAML parse on the hot path.
"""

from __future__ import annotations

from pathlib import Path
from threading import Lock

from .base import (
    PatternLoadError,
    PhraseDetector,
    PhrasePattern,
    PhrasePatternMatch,
    PhrasePatternStep,
    load_patterns,
)

# ---------------------------------------------------------------------
# Registry.
# ---------------------------------------------------------------------

_PATTERN_DIR = Path(__file__).parent / "patterns"
_LANGUAGE_FILES: dict[str, str] = {
    "hi": "hindi.yaml",
    "mr": "marathi.yaml",
    "or": "odia.yaml",
}

_cache: dict[str, PhraseDetector] = {}
_cache_lock = Lock()


def get_detector(language: str) -> PhraseDetector:
    """Return the cached :class:`PhraseDetector` for ``language``.

    Loads the per-language YAML on first use and caches the
    resulting detector. Unknown languages get an empty detector
    (zero patterns) — better than raising, since a brand-new
    language can ship without phrase patterns and still produce a
    well-formed empty ``proposed_phrases`` field on the wire.
    """
    cached = _cache.get(language)
    if cached is not None:
        return cached
    with _cache_lock:
        # Re-check inside the lock for the standard double-checked
        # locking pattern.
        cached = _cache.get(language)
        if cached is not None:
            return cached
        filename = _LANGUAGE_FILES.get(language)
        if filename is None:
            detector = PhraseDetector(())
        else:
            path = _PATTERN_DIR / filename
            if not path.exists():
                detector = PhraseDetector(())
            else:
                detector = PhraseDetector(load_patterns(path))
        _cache[language] = detector
        return detector


def _reset_cache_for_tests() -> None:
    """Drop the in-process cache. Used by pytest fixtures that
    monkey-patch the registry to swap pattern lists."""
    with _cache_lock:
        _cache.clear()


__all__ = [
    "PatternLoadError",
    "PhraseDetector",
    "PhrasePattern",
    "PhrasePatternMatch",
    "PhrasePatternStep",
    "get_detector",
    "load_patterns",
]
