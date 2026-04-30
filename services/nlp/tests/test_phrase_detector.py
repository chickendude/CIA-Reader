"""Unit tests for the rule-based phrase detector (T-14.5).

The detector is pure — feed it tokens and patterns and assert the
output. Per-language YAML loaders are exercised via the registry's
:func:`get_detector` so the seed files in
``app/phrases/patterns/`` actually get parsed.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.phrases import (
    PatternLoadError,
    PhraseDetector,
    PhrasePatternStep,
    get_detector,
    load_patterns,
)
from app.schemas import LemmaCandidate, ProposedPhrase, Token

# ---------------------------------------------------------------------
# Helpers — fabricate Stanza-shaped tokens.
# ---------------------------------------------------------------------


def tok(
    idx: int,
    surface: str,
    lemma: str | None = None,
    pos: str = "NOUN",
    *,
    is_word: bool = True,
    feats: dict[str, str] | None = None,
) -> Token:
    candidates = (
        [LemmaCandidate(lemma=lemma or surface, pos=pos, score=1.0, features=feats or {})]
        if is_word
        else []
    )
    return Token(
        idx=idx,
        surface=surface,
        is_word=is_word,
        candidates=candidates,
    )


# ---------------------------------------------------------------------
# YAML loader.
# ---------------------------------------------------------------------


class TestLoadPatterns:
    def test_loads_a_simple_two_step_pattern(self) -> None:
        raw = [
            {
                "id": "test.np_v",
                "description": "noun + verb",
                "match": [{"upos": "NOUN"}, {"lemma": "करना"}],
            }
        ]
        patterns = load_patterns(raw)
        assert len(patterns) == 1
        p = patterns[0]
        assert p.id == "test.np_v"
        assert p.description == "noun + verb"
        assert len(p.steps) == 2
        assert p.steps[0].upos == ("NOUN",)
        assert p.steps[1].lemma == ("करना",)

    def test_accepts_string_or_list_for_upos_and_lemma(self) -> None:
        raw = [
            {
                "id": "test.alt",
                "match": [
                    {"upos": ["NOUN", "ADJ"]},
                    {"lemma": "करना"},
                ],
            }
        ]
        patterns = load_patterns(raw)
        assert patterns[0].steps[0].upos == ("NOUN", "ADJ")

    def test_rejects_a_pattern_without_an_id(self) -> None:
        with pytest.raises(PatternLoadError, match="non-empty 'id'"):
            load_patterns([{"match": [{"upos": "NOUN"}, {"upos": "VERB"}]}])

    def test_rejects_duplicate_ids(self) -> None:
        with pytest.raises(PatternLoadError, match="duplicate"):
            load_patterns(
                [
                    {"id": "x", "match": [{"upos": "NOUN"}, {"upos": "VERB"}]},
                    {"id": "x", "match": [{"upos": "ADJ"}, {"upos": "VERB"}]},
                ]
            )

    def test_rejects_a_match_with_fewer_than_two_steps(self) -> None:
        with pytest.raises(PatternLoadError, match="at least 2"):
            load_patterns([{"id": "x", "match": [{"upos": "NOUN"}]}])

    def test_rejects_unknown_step_keys(self) -> None:
        with pytest.raises(PatternLoadError, match="unknown keys"):
            load_patterns(
                [
                    {
                        "id": "x",
                        "match": [
                            {"upos": "NOUN"},
                            {"banana": "yellow"},
                        ],
                    }
                ]
            )


# ---------------------------------------------------------------------
# Step matching.
# ---------------------------------------------------------------------


class TestStepMatches:
    def test_upos_predicate(self) -> None:
        step = PhrasePatternStep(upos=("NOUN",))
        assert step.matches(tok(0, "इंतज़ार", pos="NOUN"))
        assert not step.matches(tok(0, "जल्दी", pos="ADV"))

    def test_lemma_predicate_against_any_candidate(self) -> None:
        step = PhrasePatternStep(lemma=("करना",))
        token = Token(
            idx=0,
            surface="किया",
            is_word=True,
            candidates=[
                LemmaCandidate(lemma="करना", pos="VERB", score=0.9, features={}),
                LemmaCandidate(lemma="कीना", pos="VERB", score=0.1, features={}),
            ],
        )
        assert step.matches(token)

    def test_surface_predicate_is_nfc_normalised(self) -> None:
        step = PhrasePatternStep(surface=("मध्ये",))
        # Compose the same surface from a different normalisation
        # form (in practice tokens come through main.py which has
        # already NFC-normalised; this guards the matcher itself).
        assert step.matches(tok(0, "मध्ये", pos="ADP"))

    def test_skips_non_word_tokens(self) -> None:
        step = PhrasePatternStep(upos=("PUNCT",))
        assert not step.matches(tok(0, "।", is_word=False))


# ---------------------------------------------------------------------
# Detector.
# ---------------------------------------------------------------------


class TestPhraseDetector:
    def test_emits_a_proposal_for_a_two_token_match(self) -> None:
        patterns = load_patterns(
            [
                {
                    "id": "hi.conjunct_karna",
                    "match": [{"upos": "NOUN"}, {"lemma": "करना"}],
                }
            ]
        )
        detector = PhraseDetector(patterns)
        tokens = [
            tok(0, "मैंने", pos="PRON"),
            tok(1, "इंतज़ार", lemma="इंतज़ार", pos="NOUN"),
            tok(2, "किया", lemma="करना", pos="VERB"),
        ]
        out = detector.detect(tokens)
        assert out == [
            ProposedPhrase(
                start_idx=1,
                end_idx=2,
                pattern_id="hi.conjunct_karna",
                surfaces=["इंतज़ार", "किया"],
            )
        ]

    def test_emits_multiple_matches_for_repeated_occurrences(self) -> None:
        patterns = load_patterns(
            [
                {
                    "id": "hi.conjunct_karna",
                    "match": [{"upos": "NOUN"}, {"lemma": "करना"}],
                }
            ]
        )
        detector = PhraseDetector(patterns)
        tokens = [
            tok(0, "इंतज़ार", lemma="इंतज़ार", pos="NOUN"),
            tok(1, "किया", lemma="करना", pos="VERB"),
            tok(2, "और", pos="CCONJ"),
            tok(3, "इंतज़ार", lemma="इंतज़ार", pos="NOUN"),
            tok(4, "किया", lemma="करना", pos="VERB"),
        ]
        out = detector.detect(tokens)
        assert [p.start_idx for p in out] == [0, 3]

    def test_overlapping_patterns_at_the_same_start_both_emit(self) -> None:
        patterns = load_patterns(
            [
                {
                    "id": "two_step",
                    "match": [{"upos": "NOUN"}, {"upos": "VERB"}],
                },
                {
                    "id": "three_step",
                    "match": [
                        {"upos": "NOUN"},
                        {"upos": "VERB"},
                        {"upos": "AUX"},
                    ],
                },
            ]
        )
        detector = PhraseDetector(patterns)
        tokens = [
            tok(0, "इंतज़ार", pos="NOUN"),
            tok(1, "किया", pos="VERB"),
            tok(2, "है", pos="AUX"),
        ]
        out = detector.detect(tokens)
        # Both patterns match at start_idx=0; the detector emits both
        # so the consumer (T-14.3 reader, T-14.5a worker) can decide
        # longest-wins or store both.
        assert len(out) == 2
        assert {p.pattern_id for p in out} == {"two_step", "three_step"}

    def test_skips_non_word_tokens(self) -> None:
        patterns = load_patterns(
            [
                {
                    "id": "x",
                    "match": [{"upos": "NOUN"}, {"upos": "VERB"}],
                }
            ]
        )
        detector = PhraseDetector(patterns)
        tokens = [
            tok(0, "इंतज़ार", pos="NOUN"),
            tok(1, ",", is_word=False),
            tok(2, "किया", pos="VERB"),
        ]
        # The non-word token blocks the pattern from advancing —
        # even though `upos: NOUN` matches at idx 0, the next step
        # (`upos: VERB`) gets the comma, not the verb, and falls.
        assert detector.detect(tokens) == []

    def test_short_token_list_emits_nothing(self) -> None:
        patterns = load_patterns(
            [{"id": "x", "match": [{"upos": "NOUN"}, {"upos": "VERB"}]}]
        )
        detector = PhraseDetector(patterns)
        assert detector.detect([tok(0, "x")]) == []

    def test_empty_patterns_emits_nothing(self) -> None:
        detector = PhraseDetector(())
        assert detector.detect([tok(0, "x"), tok(1, "y")]) == []


# ---------------------------------------------------------------------
# Per-language YAML files.
# ---------------------------------------------------------------------


class TestLanguagePatternFiles:
    def test_hindi_yaml_loads_and_matches_a_canonical_conjunct_verb(self) -> None:
        detector = get_detector("hi")
        # Expect at least the karna conjunct rule + the compound
        # postposition के बारे में to be loaded.
        ids = {p.id for p in detector.patterns}
        assert "hi.conjunct_verb_karna" in ids
        assert "hi.compound_postp_ke_baare_mein" in ids

        # Real conjunct verb structure: NOUN इंतज़ार + light verb किया
        # (lemma करना). Detector should emit one proposal.
        tokens = [
            tok(0, "मैंने", lemma="मैं", pos="PRON"),
            tok(1, "इंतज़ार", lemma="इंतज़ार", pos="NOUN"),
            tok(2, "किया", lemma="करना", pos="VERB"),
        ]
        out = detector.detect(tokens)
        karna_matches = [p for p in out if p.pattern_id == "hi.conjunct_verb_karna"]
        assert len(karna_matches) == 1
        assert karna_matches[0].surfaces == ["इंतज़ार", "किया"]

    def test_hindi_compound_postp_ke_baare_mein_three_token_match(self) -> None:
        detector = get_detector("hi")
        tokens = [
            tok(0, "किताब", pos="NOUN"),
            tok(1, "के", pos="ADP"),
            tok(2, "बारे", pos="ADP"),
            tok(3, "में", pos="ADP"),
        ]
        out = detector.detect(tokens)
        cp = [p for p in out if p.pattern_id == "hi.compound_postp_ke_baare_mein"]
        assert len(cp) == 1
        assert cp[0].start_idx == 1
        assert cp[0].end_idx == 3
        assert cp[0].surfaces == ["के", "बारे", "में"]

    def test_marathi_yaml_loads_and_matches_a_conjunct_verb(self) -> None:
        detector = get_detector("mr")
        ids = {p.id for p in detector.patterns}
        assert "mr.conjunct_verb_karne" in ids
        tokens = [
            tok(0, "मदत", lemma="मदत", pos="NOUN"),
            tok(1, "केली", lemma="करणे", pos="VERB"),
        ]
        out = detector.detect(tokens)
        assert any(p.pattern_id == "mr.conjunct_verb_karne" for p in out)

    def test_odia_yaml_loads_and_matches_a_conjunct_verb(self) -> None:
        detector = get_detector("or")
        ids = {p.id for p in detector.patterns}
        assert "or.conjunct_verb_kariba" in ids
        tokens = [
            tok(0, "ସାହାଯ୍ୟ", lemma="ସାହାଯ୍ୟ", pos="NOUN"),
            tok(1, "କରିବ", lemma="କରିବା", pos="VERB"),
        ]
        out = detector.detect(tokens)
        assert any(p.pattern_id == "or.conjunct_verb_kariba" for p in out)

    def test_unknown_language_returns_empty_detector(self) -> None:
        detector = get_detector("xx")
        assert detector.patterns == ()
        assert detector.detect([tok(0, "x"), tok(1, "y")]) == []

    def test_pattern_files_exist(self) -> None:
        # Sanity: all three MVP languages have a YAML file on disk.
        base = Path(__file__).parent.parent / "app" / "phrases" / "patterns"
        for filename in ("hindi.yaml", "marathi.yaml", "odia.yaml"):
            assert (base / filename).exists(), f"missing {filename}"
