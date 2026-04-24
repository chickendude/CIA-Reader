"""Rule-based Odia morphological analyzer (T-2.3a).

Odia morphology is overwhelmingly agglutinative and regular — inflection
is a small set of suffixes concatenated onto a stem. That makes it
tractable to handle with a rule table: each rule names a suffix, the UD
POS it applies to, and the features it implies. To analyze a surface we
try each rule longest-first; a rule matches if the surface ends with the
suffix AND the stripped stem is in the lemma table AND the lemma's POS
matches the rule's POS constraint.

This deliberately undershoots — full Odia morphology has hundreds of
paradigm-specific suffixes (derivational, honorific, sandhi changes at
morpheme boundaries, conjunct-consonant edge cases). The MVP rule set
here covers the most common productive suffixes: the target ~70-80%
lemma-accuracy baseline comes from growing this table over time,
seeded by failures in the T-2.3b golden file and the real-world
correction rate from T-6.7.

The analyzer returns zero-or-more analyses per surface. Zero means
"no rule matched and the surface isn't in the lemma table" — the
pipeline translates that into ``is_oov=True``. Multiple analyses mean
morphology is genuinely ambiguous (e.g. a suffix form that could be
either genitive or base), which sets ``is_ambiguous=True`` so the M6
correction UX surfaces the chevron.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from .lemmas import OdiaLemma, OdiaLemmaTable


@dataclass(frozen=True, slots=True)
class MorphAnalysis:
    """One plausible (stem + features) reading of an Odia surface."""

    lemma: OdiaLemma
    features: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _Rule:
    """A single suffix-stripping rule.

    ``pos`` constrains the rule: an analysis is only produced when the
    stripped stem resolves to a lemma with matching POS. Rules with
    ``pos=None`` are POS-agnostic (used sparingly — mostly for clitics).
    """

    suffix: str
    pos: str | None
    features: dict[str, str]


# Noun paradigm. Odia nouns inflect for number and case via concatenative
# suffixes. Listed longest-first so "ମାନଙ୍କୁ" (plural accusative) matches
# before the shorter "କୁ".
_NOUN_RULES: tuple[_Rule, ...] = (
    _Rule("ମାନଙ୍କୁ", "NOUN", {"Number": "Plur", "Case": "Acc"}),
    _Rule("ମାନଙ୍କ", "NOUN", {"Number": "Plur", "Case": "Gen"}),
    _Rule("ମାନଙ୍କରେ", "NOUN", {"Number": "Plur", "Case": "Loc"}),
    _Rule("ମାନଙ୍କଠାରୁ", "NOUN", {"Number": "Plur", "Case": "Abl"}),
    _Rule("ମାନେ", "NOUN", {"Number": "Plur", "Case": "Nom"}),
    _Rule("ଦ୍ୱାରା", "NOUN", {"Case": "Ins"}),
    _Rule("ଠାରୁ", "NOUN", {"Case": "Abl"}),
    _Rule("ରେ", "NOUN", {"Case": "Loc"}),
    _Rule("କୁ", "NOUN", {"Case": "Acc"}),
    _Rule("ରୁ", "NOUN", {"Case": "Abl"}),
    _Rule("ର", "NOUN", {"Case": "Gen"}),
)


# Verb paradigm. Tense / aspect / person / number / gender suffixes. This
# is a deliberately small subset of a big paradigm — enough to cover the
# frequent present / past / infinitive forms in the T-2.3b corpus; deep
# coverage is an ongoing effort seeded by the correction UX.
_VERB_RULES: tuple[_Rule, ...] = (
    _Rule("ନ୍ତି", "VERB", {"Tense": "Pres", "Person": "3", "Number": "Plur"}),
    _Rule("ଉଥିଲେ", "VERB", {"Tense": "Past", "Aspect": "Prog", "Person": "3"}),
    _Rule("ଉଥିଲି", "VERB", {"Tense": "Past", "Aspect": "Prog", "Person": "1"}),
    _Rule("ଉଛନ୍ତି", "VERB", {"Tense": "Pres", "Aspect": "Prog", "Person": "3", "Number": "Plur"}),
    _Rule("ଉଛି", "VERB", {"Tense": "Pres", "Aspect": "Prog", "Person": "1"}),
    _Rule("ିଲେ", "VERB", {"Tense": "Past", "Person": "3"}),
    _Rule("ିଲା", "VERB", {"Tense": "Past", "Person": "3", "Number": "Sing"}),
    _Rule("ିବା", "VERB", {"VerbForm": "Inf"}),
    _Rule("ିବେ", "VERB", {"Tense": "Fut", "Person": "3"}),
    _Rule("ିବ", "VERB", {"Tense": "Fut"}),
    _Rule("ଏ", "VERB", {"Tense": "Pres", "Person": "3", "Number": "Sing"}),
)


# Adjective agreement. Odia adjectives can take a small set of gender /
# number agreement suffixes; many don't inflect at all. Covering the
# non-inflecting case is done by the "exact lemma match" path rather
# than by rules here.
_ADJ_RULES: tuple[_Rule, ...] = (
    _Rule("ତର", "ADJ", {"Degree": "Cmp"}),
    _Rule("ତମ", "ADJ", {"Degree": "Sup"}),
)


# Combined, sorted longest-first so the stripping loop always prefers
# the most specific suffix. Tuple is immutable on purpose — morphology
# rule drift should require a code review, not a runtime mutation.
_ALL_RULES: tuple[_Rule, ...] = tuple(
    sorted(
        _NOUN_RULES + _VERB_RULES + _ADJ_RULES,
        key=lambda r: len(r.suffix),
        reverse=True,
    )
)


def analyze(surface: str, lemmas: OdiaLemmaTable) -> list[MorphAnalysis]:
    """Return all plausible morphological analyses of an Odia surface.

    Ordering: exact-lemma match first (if the surface is itself a
    headword, that's the strongest reading), then suffix-stripping
    matches longest-first. Duplicates (same lemma + same features) are
    de-duped so an adjective that lives both in the lemma table AND
    matches a vacuous rule doesn't surface twice.
    """
    analyses: list[MorphAnalysis] = []
    seen: set[tuple[str, str, frozenset[tuple[str, str]]]] = set()

    def _add(lemma: OdiaLemma, features: dict[str, str]) -> None:
        key = (lemma.headword, lemma.pos, frozenset(features.items()))
        if key in seen:
            return
        seen.add(key)
        analyses.append(MorphAnalysis(lemma=lemma, features=dict(features)))

    # Exact lemma match: the surface itself is the headword (uninflected).
    exact = lemmas.lookup(surface)
    if exact is not None:
        _add(exact, {})

    for rule in _ALL_RULES:
        if not surface.endswith(rule.suffix):
            continue
        stem = surface[: -len(rule.suffix)]
        if not stem:
            continue
        lemma = lemmas.lookup(stem)
        if lemma is None:
            continue
        if rule.pos is not None and lemma.pos != rule.pos:
            continue
        _add(lemma, rule.features)

    return analyses


def rules() -> Sequence[_Rule]:
    """Expose the rule table (read-only) for introspection + tests."""
    return _ALL_RULES


__all__ = ["MorphAnalysis", "analyze", "rules"]
