"""Unit tests for :class:`app.pipelines.hindi.HindiPipeline` (T-2.2).

We inject a minimal fake Stanza-like object rather than running the real
model, so these tests exercise the pipeline's output shaping logic —
feature parsing, POS-aware ``is_word`` / ``is_oov``, token indexing
across sentences — without a ~600MB model download. The trade-off is
we're testing our adapter, not Stanza itself; Stanza's own accuracy is
covered by the golden-file suite (T-2.8).

The shared output-shaping logic was extracted into
:mod:`app.pipelines.stanza_ud` in T-2.3 so Marathi could reuse it; the
feature-parsing tests target ``parse_feats`` at its new public home but
the HindiPipeline behavior tests stay here to pin down the
language-specific contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.pipelines.hindi import HindiPipeline, _restore_nukta_in_lemma
from app.pipelines.stanza_ud import parse_feats


@dataclass
class FakeWord:
    text: str
    lemma: str | None = None
    upos: str = "NOUN"
    feats: str | None = None


@dataclass
class FakeSentence:
    words: list[FakeWord] = field(default_factory=list)


@dataclass
class FakeDoc:
    sentences: list[FakeSentence] = field(default_factory=list)


class FakeStanza:
    """Returns a pre-built :class:`FakeDoc` regardless of input text."""

    def __init__(self, doc: FakeDoc) -> None:
        self._doc = doc
        self.calls: list[str] = []

    def __call__(self, text: str) -> FakeDoc:
        self.calls.append(text)
        return self._doc


def _pipe(doc: FakeDoc) -> tuple[HindiPipeline, FakeStanza]:
    fake = FakeStanza(doc)
    return HindiPipeline(nlp=fake), fake


# --- parse_feats --------------------------------------------------------


def test_parse_feats_none_returns_empty():
    assert parse_feats(None) == {}


def test_parse_feats_empty_string_returns_empty():
    assert parse_feats("") == {}


def test_parse_feats_single_pair():
    assert parse_feats("Number=Sing") == {"Number": "Sing"}


def test_parse_feats_multiple_pairs():
    out = parse_feats("Tense=Pres|Number=Sing|Person=3|Gender=Fem|Aspect=Hab")
    assert out == {
        "Tense": "Pres",
        "Number": "Sing",
        "Person": "3",
        "Gender": "Fem",
        "Aspect": "Hab",
    }


def test_parse_feats_skips_malformed_pairs():
    # Defensive: a stray token or missing "=" from a Stanza model update
    # shouldn't surface as a 500 on /process.
    out = parse_feats("Tense=Pres|bogus|Number=Sing|=orphan")
    assert out == {"Tense": "Pres", "Number": "Sing"}


# --- HindiPipeline.process ----------------------------------------------


def test_process_empty_doc_produces_zero_tokens():
    pipe, _ = _pipe(FakeDoc(sentences=[]))
    result = pipe.process("")
    assert result.pipeline_id == "stanza-hi"
    assert result.tokens == []


def test_process_returns_canonical_pipeline_id():
    pipe, _ = _pipe(FakeDoc(sentences=[FakeSentence(words=[FakeWord("बोलता", lemma="बोलना")])]))
    assert pipe.process("whatever").pipeline_id == "stanza-hi"


def test_process_extracts_lemma_pos_and_features():
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(
                        text="बोलती",
                        lemma="बोलना",
                        upos="VERB",
                        feats="Tense=Pres|Number=Sing|Person=3|Gender=Fem|Aspect=Hab",
                    )
                ]
            )
        ]
    )
    pipe, _ = _pipe(doc)
    result = pipe.process("she-speaks")
    assert len(result.tokens) == 1
    tok = result.tokens[0]
    assert tok.surface == "बोलती"
    assert tok.is_word is True
    assert tok.is_oov is False  # lemma differs from surface
    assert tok.is_ambiguous is False  # top-K disambiguation lands later
    assert len(tok.candidates) == 1
    cand = tok.candidates[0]
    assert cand.lemma == "बोलना"
    assert cand.pos == "VERB"
    assert cand.score == 1.0
    assert cand.features["Tense"] == "Pres"
    assert cand.features["Gender"] == "Fem"


def test_process_flags_oov_when_lemma_equals_surface_for_content_word():
    doc = FakeDoc(
        sentences=[
            FakeSentence(words=[FakeWord(text="फ़्लर्ब", lemma="फ़्लर्ब", upos="NOUN")])
        ]
    )
    pipe, _ = _pipe(doc)
    result = pipe.process("x")
    tok = result.tokens[0]
    assert tok.is_oov is True


def test_process_does_not_flag_oov_for_proper_nouns():
    # Proper nouns legitimately have lemma == surface. Marking them OOV
    # would trigger the correction UX in M6 for every name in the text,
    # which would be terrible UX. The PROPN guard prevents that.
    doc = FakeDoc(
        sentences=[
            FakeSentence(words=[FakeWord(text="रवि", lemma="रवि", upos="PROPN")])
        ]
    )
    pipe, _ = _pipe(doc)
    assert pipe.process("x").tokens[0].is_oov is False


def test_process_does_not_flag_oov_for_numbers_punctuation_symbols():
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(text="42", lemma="42", upos="NUM"),
                    FakeWord(text="।", lemma="।", upos="PUNCT"),
                    FakeWord(text="%", lemma="%", upos="SYM"),
                    FakeWord(text="hello", lemma="hello", upos="X"),
                ]
            )
        ]
    )
    pipe, _ = _pipe(doc)
    tokens = pipe.process("x").tokens
    assert [t.is_oov for t in tokens] == [False, False, False, False]


def test_process_ignores_latin_only_words_when_script_known():
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(text="Edit", lemma="Edit", upos="X"),
                    FakeWord(text="this", lemma="this", upos="X"),
                    FakeWord(text="बोलता", lemma="बोलना", upos="VERB"),
                ]
            )
        ]
    )
    pipe = HindiPipeline(nlp=FakeStanza(doc), script="Deva")
    tokens = pipe.process("Edit this बोलता").tokens
    assert [t.is_word for t in tokens] == [False, False, True]
    assert [t.is_oov for t in tokens] == [False, False, False]


def test_process_keeps_numeric_tokens_even_when_script_known():
    doc = FakeDoc(
        sentences=[FakeSentence(words=[FakeWord(text="1910", lemma="1910", upos="NUM")])]
    )
    pipe = HindiPipeline(nlp=FakeStanza(doc), script="Deva")
    tok = pipe.process("1910").tokens[0]
    assert tok.is_word is True
    assert tok.is_oov is False


def test_process_marks_punctuation_as_non_word():
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(text="बोलता", lemma="बोलना", upos="VERB"),
                    FakeWord(text="।", lemma="।", upos="PUNCT"),
                ]
            )
        ]
    )
    pipe, _ = _pipe(doc)
    tokens = pipe.process("x").tokens
    assert tokens[0].is_word is True
    assert tokens[1].is_word is False


def test_process_marks_coordinate_fragments_as_non_words():
    # Stanza may split a DMS coordinate like "113°43′6″W" into
    # "113°43" + "′6″W" and tag the first chunk as PROPN. The reader
    # must still render both as plain text, not as underlined/clickable
    # dictionary words. Plain digit-only numbers remain handled by the
    # number popup; coordinate fragments do not get number_forms.
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(text="48°41′48″N", lemma="48°41′48″N", upos="PROPN"),
                    FakeWord(text="113°43", lemma="113°43", upos="PROPN"),
                    FakeWord(text="′6″W", lemma="′6″W", upos="PROPN"),
                    FakeWord(text="2024", lemma="2024", upos="NUM"),
                ]
            )
        ]
    )
    pipe, _ = _pipe(doc)
    tokens = pipe.process("x").tokens
    assert [t.is_word for t in tokens] == [False, False, False, True]
    assert [t.romanization for t in tokens[:3]] == [None, None, None]
    assert [t.number_forms for t in tokens[:3]] == [None, None, None]
    assert tokens[3].number_forms is not None


def test_process_indexes_tokens_contiguously_across_sentences():
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[FakeWord(text="एक"), FakeWord(text="दो")]
            ),
            FakeSentence(
                words=[FakeWord(text="तीन"), FakeWord(text="चार")]
            ),
        ]
    )
    pipe, _ = _pipe(doc)
    result = pipe.process("x")
    assert [t.idx for t in result.tokens] == [0, 1, 2, 3]
    assert [t.surface for t in result.tokens] == ["एक", "दो", "तीन", "चार"]


def test_process_defaults_missing_upos_and_lemma_safely():
    # Stanza can emit word.lemma=None when the lemmatizer declines to
    # pick; word.upos can also be None if POS wasn't run. The pipeline
    # must not crash — defaulting to surface / "X" is the documented
    # behavior.
    doc = FakeDoc(
        sentences=[FakeSentence(words=[FakeWord(text="foo", lemma=None, upos=None)])]  # type: ignore[arg-type]
    )
    pipe, _ = _pipe(doc)
    tok = pipe.process("x").tokens[0]
    assert tok.candidates[0].lemma == "foo"
    assert tok.candidates[0].pos == "X"
    # Lemma==surface and POS=X: X is in _NON_OOV_UPOS (code-switch), so
    # we do NOT flag this as OOV.
    assert tok.is_oov is False


def test_process_passes_input_text_through_to_stanza():
    pipe, fake = _pipe(FakeDoc(sentences=[]))
    pipe.process("the quick brown fox")
    assert fake.calls == ["the quick brown fox"]


# --- nukta restoration -------------------------------------------------
#
# Stanza's hi_hdtb model returns lemmas with the U+093C nukta stripped
# for nukta-bearing verbs (पढ़ता → पढना instead of पढ़ना). The pipeline
# patches this by lifting any nuktas surviving in the surface back into
# the aligned lemma position. These tests pin the rule independently of
# the real Stanza model so the fix can't silently regress.


def test_restore_nukta_basic_present_tense():
    # पढ़ता (he reads) — the canonical bug. Stanza returns पढना.
    assert _restore_nukta_in_lemma("पढ़ता", "पढना") == "पढ़ना"


def test_restore_nukta_imperative_subjunctive():
    # पढ़ें — the form the bug report cited. Same root, different inflection.
    assert _restore_nukta_in_lemma("पढ़ें", "पढना") == "पढ़ना"


def test_restore_nukta_future_feminine():
    assert _restore_nukta_in_lemma("बढ़ेगी", "बढना") == "बढ़ना"


def test_restore_nukta_multi_consonant_stem():
    # पकड़ना (to catch) — nukta on the third consonant of the stem,
    # not the second. The walker must align before deciding.
    assert _restore_nukta_in_lemma("पकड़ता", "पकडना") == "पकड़ना"


def test_restore_nukta_word_medial_nukta_in_noun():
    # Loan-word noun with a word-medial nukta. If Stanza ever strips
    # those for nominal lemmas the rule still recovers it.
    assert _restore_nukta_in_lemma("ज़मीन", "जमीन") == "ज़मीन"


def test_restore_nukta_idempotent_when_stanza_already_correct():
    # If a future Stanza release stops stripping the nukta, the helper
    # must not double-insert.
    assert _restore_nukta_in_lemma("पढ़ता", "पढ़ना") == "पढ़ना"


def test_restore_nukta_noop_when_surface_has_no_nukta():
    assert _restore_nukta_in_lemma("कहता", "कहना") == "कहना"


def test_restore_nukta_passes_through_suppletive_lemma():
    # हूँ → होना diverges at the second character, so no nukta gets
    # spliced and the suppletive lemma comes through untouched.
    assert _restore_nukta_in_lemma("हूँ", "होना") == "होना"


def test_restore_nukta_handles_atomic_precomposed_lemma():
    # Stanza's internal lemma table can store the precomposed nukta
    # consonant (U+095D) instead of the decomposed base+U+093C form.
    # NFC keeps it precomposed (composition exclusion), so the helper
    # must NFD-equivalent normalize internally — verified here by
    # feeding an atomic-form lemma and expecting decomposed output.
    surface = "पढ़ता"  # decomposed: ढ + U+093C
    atomic_lemma = "पढ़ना"  # ढ़ as U+095D atomic
    assert _restore_nukta_in_lemma(surface, atomic_lemma) == "पढ़ना"


def test_process_restores_nukta_in_token_lemma():
    # End-to-end: the pipeline patches Stanza's stripped lemma before
    # emitting the token. is_oov stays False (lemma differed from
    # surface in Stanza's raw output, which is what is_oov keys on).
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(
                        text="पढ़ें",
                        lemma="पढना",
                        upos="VERB",
                        feats="VerbForm=Fin|Mood=Sub",
                    )
                ]
            )
        ]
    )
    pipe, _ = _pipe(doc)
    tok = pipe.process("x").tokens[0]
    assert tok.candidates[0].lemma == "पढ़ना"
    assert tok.is_oov is False


def test_process_does_not_touch_lemma_without_nukta_in_surface():
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[FakeWord(text="कहता", lemma="कहना", upos="VERB")]
            )
        ]
    )
    pipe, _ = _pipe(doc)
    assert pipe.process("x").tokens[0].candidates[0].lemma == "कहना"


def test_process_leaves_punctuation_untouched_even_with_adjacent_nukta_word():
    # Defensive: the post-processor must skip non-word tokens, not just
    # leave their lemmas alone — a future Token revision that keys off
    # candidates being rebuilt could regress this.
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(text="पढ़ता", lemma="पढना", upos="VERB"),
                    FakeWord(text="।", lemma="।", upos="PUNCT"),
                ]
            )
        ]
    )
    pipe, _ = _pipe(doc)
    tokens = pipe.process("x").tokens
    assert tokens[0].candidates[0].lemma == "पढ़ना"
    assert tokens[1].is_word is False
    assert tokens[1].candidates[0].lemma == "।"
