"""Rule-based Yiddish morphological analyzer.

The same shape as :mod:`app.pipelines.odia.morph` — a small table of
affix-stripping rules checked against a lemma table — with two
Yiddish-specific extensions:

* **Stem-based verb rules.** Yiddish conjugates on the stem (שרײַב)
  while the dictionary cites the infinitive (שרײַבן), so verb rules
  strip a suffix and look the remainder up in the table's *stem*
  index; the produced analysis carries the citation headword. Noun and
  adjective rules strip back to the headword itself, like Odia.
* **Circumfix rules.** Weak past participles wrap the stem in גע־…־ט
  (לערנען → געלערנט), so a rule may declare a prefix alongside its
  suffix. Strong participles ablaut the stem (שרײַבן → געשריבן) and
  are listed per-lemma in the seed's ``forms`` map instead.

The analyzer returns zero-or-more analyses per surface. Zero →
``is_oov=True``. Multiple analyses are genuinely ambiguous Yiddish —
שרײַבן is both the infinitive and the 1pl/3pl present, ־ט marks both
3sg and 2pl — and surface as ``is_ambiguous=True`` so the reader's
correction UX shows the chevron. Yiddish disambiguates by pronoun,
not verb morphology, so shared endings carry deliberately sparse
feature sets: better no claim than a wrong one in the popup.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from .lemmas import YiddishLemma, YiddishLemmaTable


@dataclass(frozen=True, slots=True)
class MorphAnalysis:
    """One plausible (lemma + features) reading of a Yiddish surface.

    ``romanization`` is the phonetic YIVO reading of *this surface*
    when the seed declares one (loshn-koydesh vocabulary, where the
    rule-based letter mapping is wrong). ``None`` defers to the
    rule-based romanizer.
    """

    lemma: YiddishLemma
    features: dict[str, str] = field(default_factory=dict)
    romanization: str | None = None


@dataclass(frozen=True, slots=True)
class _Rule:
    """A single affix-stripping rule.

    ``base`` names the index the stripped remainder must match:
    ``"stem"`` for verb conjugation, ``"headword"`` for noun/adjective
    inflection. ``pos`` constrains which lemmas the rule may produce.
    ``prefix`` is non-empty only for the גע־ participle circumfixes.
    """

    suffix: str
    pos: str
    base: str
    features: dict[str, str]
    prefix: str = ""


# Verb paradigm (suffixes attach to the stem). The 2sg ־סט is the only
# person/number ending unique to one slot; ־ט is 3sg or 2pl and ־ן/־ען
# is 1pl, 3pl or the infinitive, so those rules assert tense only.
_VERB_RULES: tuple[_Rule, ...] = (
    _Rule("סט", "VERB", "stem", {"Tense": "Pres", "Person": "2", "Number": "Sing"}),
    _Rule("ט", "VERB", "stem", {"Tense": "Pres"}),
    _Rule("ען", "VERB", "stem", {"Tense": "Pres"}),
    _Rule("ן", "VERB", "stem", {"Tense": "Pres"}),
    # Weak past participle: גע־ + stem + ־ט (לערנען → געלערנט). The
    # ־ן/־ען variants mostly belong to ablauting strong verbs whose
    # stems won't match (those live in the seed's `forms`), but a few
    # strong verbs keep their stem vowel (געגעבן), so the rules stay.
    _Rule("ט", "VERB", "stem", {"VerbForm": "Part"}, prefix="גע"),
    _Rule("ען", "VERB", "stem", {"VerbForm": "Part"}, prefix="גע"),
    _Rule("ן", "VERB", "stem", {"VerbForm": "Part"}, prefix="גע"),
)


# Noun plurals (suffixes attach to the headword). Umlaut plurals
# (בוך → ביכער, טאָג → טעג) can't be stripped back to their headword
# and are listed in the seed's `forms` instead.
_NOUN_RULES: tuple[_Rule, ...] = (
    _Rule("עס", "NOUN", "headword", {"Number": "Plur"}),
    _Rule("ער", "NOUN", "headword", {"Number": "Plur"}),
    _Rule("ען", "NOUN", "headword", {"Number": "Plur"}),
    _Rule("ים", "NOUN", "headword", {"Number": "Plur"}),
    _Rule("ס", "NOUN", "headword", {"Number": "Plur"}),
    _Rule("ן", "NOUN", "headword", {"Number": "Plur"}),
)


# Adjective agreement endings. Each ending covers several
# gender/case/number cells (and ־ער doubles as the comparative), so no
# features are asserted — the win is attaching the inflected form to
# its root, not guessing the cell.
_ADJ_RULES: tuple[_Rule, ...] = (
    _Rule("ער", "ADJ", "headword", {}),
    _Rule("עם", "ADJ", "headword", {}),
    _Rule("ע", "ADJ", "headword", {}),
    _Rule("ן", "ADJ", "headword", {}),
)


# Combined, sorted by total affix length (longest first) so the
# stripping loop prefers the most specific match. Immutable on purpose
# — rule drift should require a code review.
_ALL_RULES: tuple[_Rule, ...] = tuple(
    sorted(
        _VERB_RULES + _NOUN_RULES + _ADJ_RULES,
        key=lambda r: len(r.prefix) + len(r.suffix),
        reverse=True,
    )
)


# Features for a surface that *is* a bare verb stem (איך שרײַב). The
# bare stem also serves as the singular imperative; like the shared
# ־ט/־ן endings we only assert what's common to both readings.
_BARE_STEM_FEATURES: dict[str, str] = {"Tense": "Pres", "Person": "1", "Number": "Sing"}


def analyze(surface: str, lemmas: YiddishLemmaTable) -> list[MorphAnalysis]:
    """Return all plausible morphological analyses of a Yiddish surface.

    Ordering — strongest reading first, so ``candidates[0]`` is the
    best lemma for the reader and the eval harness:

    1. exact headword match (the surface is a citation form);
    2. explicit irregular forms from the seed (בין → זײַן);
    3. bare-stem match (איך שרײַב → שרײַבן);
    4. affix rules, longest affix first.

    Duplicates (same lemma + features) are de-duped, mirroring Odia.
    """
    analyses: list[MorphAnalysis] = []
    seen: set[tuple[str, str, frozenset[tuple[str, str]]]] = set()

    def _add(
        lemma: YiddishLemma,
        features: dict[str, str],
        romanization: str | None = None,
    ) -> None:
        key = (lemma.headword, lemma.pos, frozenset(features.items()))
        if key in seen:
            return
        seen.add(key)
        analyses.append(
            MorphAnalysis(
                lemma=lemma,
                features=dict(features),
                romanization=romanization,
            )
        )

    exact = lemmas.lookup(surface)
    if exact is not None:
        _add(exact, {}, romanization=exact.romanization)

    for lemma, form in lemmas.lookup_form(surface):
        _add(lemma, form.features, romanization=form.romanization)

    for lemma in lemmas.lookup_stem(surface):
        _add(lemma, _BARE_STEM_FEATURES)

    for rule in _ALL_RULES:
        if not surface.endswith(rule.suffix):
            continue
        if rule.prefix and not surface.startswith(rule.prefix):
            continue
        core = surface[len(rule.prefix) : len(surface) - len(rule.suffix)]
        if not core:
            continue
        if rule.base == "stem":
            for lemma in lemmas.lookup_stem(core):
                if lemma.pos == rule.pos:
                    _add(lemma, rule.features)
        else:
            lemma = lemmas.lookup(core)
            if lemma is not None and lemma.pos == rule.pos:
                _add(lemma, rule.features)

    return analyses


def rules() -> Sequence[_Rule]:
    """Expose the rule table (read-only) for introspection + tests."""
    return _ALL_RULES


__all__ = ["MorphAnalysis", "analyze", "rules"]
