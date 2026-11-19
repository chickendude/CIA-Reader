"""Propose phrases by matching a language's patterns against the words returned by the parser."""

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
