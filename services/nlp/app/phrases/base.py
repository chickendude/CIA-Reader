"""Rule-based phrase detector (T-14.5).

Loads per-language YAML patterns and matches them against a
:class:`app.pipelines.base.PipelineResult` token list. Each pattern
is an ordered sequence of "step" predicates over a token's UD POS,
lemma, and morphology features; a match emits a
:class:`app.schemas.ProposedPhrase`.

YAML schema (see ``patterns/<lang>.yaml``):

.. code-block:: yaml

    - id: hi.conjunct_verb_karna
      description: "Conjunct verb with करना (light verb)"
      match:
        - upos: [NOUN, ADJ]
        - lemma: करना

    - id: hi.compound_postposition_ke_baare_mein
      description: "Compound postposition ke baare mein"
      match:
        - lemma: का            # के, का, की are all the genitive postposition
        - lemma: बारा           # बारे inflected
          # `lemma` matches against a candidate's lemma; multiple
          # candidates per token are tried independently.

Step predicates:

* ``upos``: string or list of strings — match against the token's
  top candidate's POS (Stanza UD tag).
* ``lemma``: string or list of strings — match against any
  candidate lemma on the token (Stanza emits a single best lemma in
  current pipelines, but the schema supports top-K).
* ``surface``: string or list of strings — match the literal NFC
  surface form. Useful for closed-class function words where lemma
  is unreliable (e.g. compound postpositions).
* ``feats``: ``{key: value | list[value]}`` — match selected
  morphology features (each key must match if specified).

A step matches a token iff every specified predicate matches; an
empty step (no predicates) matches any token. A pattern matches a
token run iff every step matches consecutive tokens in order. The
detector emits one match per starting position; longer overlapping
matches at the same start are kept (longest-wins is a render-time
decision in T-14.3).
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.schemas import ProposedPhrase, Token

# ---------------------------------------------------------------------
# Pattern model.
# ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PhrasePatternStep:
    """One position in a phrase pattern. Each predicate is optional;
    when set, the step matches a token iff every set predicate
    matches. The empty step matches any token (rare in practice but
    useful for skipping a discourse marker once gappy patterns
    land).
    """

    upos: tuple[str, ...] = ()
    lemma: tuple[str, ...] = ()
    surface: tuple[str, ...] = ()
    feats: tuple[tuple[str, tuple[str, ...]], ...] = ()

    def matches(self, token: Token) -> bool:
        # Skip non-word tokens — phrases don't contain whitespace
        # or punctuation. Even if the YAML rule didn't say so,
        # this guard saves every per-language file from repeating it.
        if not token.is_word:
            return False
        if self.upos:
            top = token.candidates[0] if token.candidates else None
            if top is None or top.pos not in self.upos:
                return False
        if self.lemma:
            if not any(c.lemma in self.lemma for c in token.candidates):
                return False
        if self.surface:
            if _nfc(token.surface) not in {_nfc(s) for s in self.surface}:
                return False
        if self.feats:
            top = token.candidates[0] if token.candidates else None
            if top is None:
                return False
            for key, allowed in self.feats:
                if top.features.get(key) not in allowed:
                    return False
        return True


@dataclass(frozen=True, slots=True)
class PhrasePattern:
    """A named ordered sequence of step predicates."""

    id: str
    description: str
    steps: tuple[PhrasePatternStep, ...]

    @property
    def length(self) -> int:
        return len(self.steps)


@dataclass(frozen=True, slots=True)
class PhrasePatternMatch:
    """Internal match record — converted to
    :class:`app.schemas.ProposedPhrase` by :class:`PhraseDetector`."""

    pattern_id: str
    start_idx: int
    end_idx: int
    surfaces: tuple[str, ...]


# ---------------------------------------------------------------------
# YAML loader.
# ---------------------------------------------------------------------


class PatternLoadError(ValueError):
    """Raised when a YAML pattern file is structurally invalid.

    The message includes the offending pattern id (when available)
    and the offending key / value so curators get actionable
    diagnostics.
    """


def _coerce_str_list(raw: Any, *, key: str, pattern_id: str) -> tuple[str, ...]:
    if raw is None:
        return ()
    if isinstance(raw, str):
        return (raw,)
    if isinstance(raw, list) and all(isinstance(x, str) for x in raw):
        return tuple(raw)
    raise PatternLoadError(
        f"pattern {pattern_id!r}: expected string or list of strings for "
        f"{key!r}, got {type(raw).__name__}"
    )


def _coerce_feats(
    raw: Any, *, pattern_id: str
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    if raw is None:
        return ()
    if not isinstance(raw, dict):
        raise PatternLoadError(
            f"pattern {pattern_id!r}: 'feats' must be a mapping, got "
            f"{type(raw).__name__}"
        )
    out: list[tuple[str, tuple[str, ...]]] = []
    for key, val in raw.items():
        if not isinstance(key, str):
            raise PatternLoadError(
                f"pattern {pattern_id!r}: 'feats' keys must be strings"
            )
        out.append((key, _coerce_str_list(val, key=f"feats.{key}", pattern_id=pattern_id)))
    return tuple(out)


def _step_from_dict(raw: Any, *, pattern_id: str, idx: int) -> PhrasePatternStep:
    if raw is None:
        return PhrasePatternStep()
    if not isinstance(raw, dict):
        raise PatternLoadError(
            f"pattern {pattern_id!r}: step #{idx} must be a mapping or "
            f"empty, got {type(raw).__name__}"
        )
    allowed_keys = {"upos", "lemma", "surface", "feats"}
    extra = set(raw.keys()) - allowed_keys
    if extra:
        raise PatternLoadError(
            f"pattern {pattern_id!r}: step #{idx} has unknown keys: "
            f"{sorted(extra)}"
        )
    return PhrasePatternStep(
        upos=_coerce_str_list(raw.get("upos"), key="upos", pattern_id=pattern_id),
        lemma=_coerce_str_list(raw.get("lemma"), key="lemma", pattern_id=pattern_id),
        surface=_coerce_str_list(
            raw.get("surface"), key="surface", pattern_id=pattern_id
        ),
        feats=_coerce_feats(raw.get("feats"), pattern_id=pattern_id),
    )


def load_patterns(source: str | Path | list[Any]) -> tuple[PhrasePattern, ...]:
    """Parse a YAML pattern file or a pre-decoded list of pattern
    dicts. Raises :class:`PatternLoadError` on any structural issue.
    """
    if isinstance(source, (str, Path)):
        path = Path(source)
        with path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
    else:
        raw = source

    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise PatternLoadError(
            f"pattern source must decode to a list of patterns, got "
            f"{type(raw).__name__}"
        )

    patterns: list[PhrasePattern] = []
    seen_ids: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise PatternLoadError(
                f"each pattern must be a mapping, got {type(entry).__name__}"
            )
        pattern_id = entry.get("id")
        if not isinstance(pattern_id, str) or not pattern_id:
            raise PatternLoadError("each pattern requires a non-empty 'id'")
        if pattern_id in seen_ids:
            raise PatternLoadError(f"duplicate pattern id: {pattern_id!r}")
        seen_ids.add(pattern_id)
        description = entry.get("description")
        if description is not None and not isinstance(description, str):
            raise PatternLoadError(
                f"pattern {pattern_id!r}: 'description' must be a string"
            )
        match_list = entry.get("match")
        if not isinstance(match_list, list) or len(match_list) < 2:
            raise PatternLoadError(
                f"pattern {pattern_id!r}: 'match' must be a list of at "
                f"least 2 step entries"
            )
        steps = tuple(
            _step_from_dict(s, pattern_id=pattern_id, idx=i)
            for i, s in enumerate(match_list)
        )
        patterns.append(
            PhrasePattern(
                id=pattern_id,
                description=description or "",
                steps=steps,
            )
        )
    return tuple(patterns)


# ---------------------------------------------------------------------
# Matcher.
# ---------------------------------------------------------------------


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


class PhraseDetector:
    """Apply a list of patterns to a token sequence and emit
    :class:`ProposedPhrase` rows.

    Construct with the per-language patterns (typically loaded from
    one of the YAML files in :mod:`.patterns`). The detector is
    stateless and thread-safe; reuse instances across requests.
    """

    def __init__(self, patterns: tuple[PhrasePattern, ...]) -> None:
        self._patterns = patterns

    @property
    def patterns(self) -> tuple[PhrasePattern, ...]:
        return self._patterns

    def detect(self, tokens: list[Token]) -> list[ProposedPhrase]:
        """Walk ``tokens`` once per pattern and emit proposals.

        Multiple patterns may emit at the same ``start_idx`` —
        downstream (T-14.3 reader, T-14.5a worker) handles the
        precedence. Patterns may overlap freely; the detector itself
        applies no longest-wins logic.
        """
        if not tokens or not self._patterns:
            return []
        out: list[ProposedPhrase] = []
        n = len(tokens)
        for pattern in self._patterns:
            steps = pattern.steps
            length = pattern.length
            if n < length:
                continue
            i = 0
            while i + length <= n:
                ok = True
                for k, step in enumerate(steps):
                    if not step.matches(tokens[i + k]):
                        ok = False
                        break
                if ok:
                    surfaces = tuple(
                        _nfc(tokens[i + k].surface) for k in range(length)
                    )
                    out.append(
                        ProposedPhrase(
                            start_idx=tokens[i].idx,
                            end_idx=tokens[i + length - 1].idx,
                            pattern_id=pattern.id,
                            surfaces=list(surfaces),
                        )
                    )
                i += 1
        # Sort by (start_idx, length) for deterministic ordering —
        # makes wire payloads and tests stable regardless of pattern
        # iteration order.
        out.sort(key=lambda p: (p.start_idx, p.end_idx))
        return out


__all__ = [
    "PatternLoadError",
    "PhraseDetector",
    "PhrasePattern",
    "PhrasePatternMatch",
    "PhrasePatternStep",
    "load_patterns",
]
