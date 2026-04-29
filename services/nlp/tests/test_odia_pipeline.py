"""Unit tests for :class:`app.pipelines.odia.OdiaPipeline` (T-2.3a).

Three concerns covered here:

1. The pipeline wires tokenizer + morphology + lemma table in the right
   order and emits the shared :class:`Token` shape.
2. ``is_oov``, ``is_ambiguous``, and ``is_word`` are set by the rules
   the plan calls out — no morphology match → OOV; ≥2 analyses →
   ambiguous; punctuation → not a word.
3. The tokenizer is injectable, so the real IndicNLP dep isn't needed
   in CI. The production factory lazy-imports it.

The morphology rules themselves have their own :mod:`test_odia_morph`
suite; the tests here target only the pipeline-level glue.
"""

from __future__ import annotations

from collections.abc import Callable

from app.pipelines.odia import OdiaPipeline
from app.pipelines.odia.lemmas import OdiaLemma, OdiaLemmaTable


def _split(text: str) -> list[str]:
    return text.split()


def _table(**entries: OdiaLemma) -> OdiaLemmaTable:
    return OdiaLemmaTable(entries)


def _pipe(
    lemmas: OdiaLemmaTable | None = None,
    tokenizer: Callable[[str], list[str]] = _split,
) -> OdiaPipeline:
    return OdiaPipeline(tokenizer=tokenizer, lemmas=lemmas or _table())


def test_pipeline_id_is_custom_or():
    assert _pipe().process("").pipeline_id == "custom-or"


def test_empty_input_produces_zero_tokens():
    assert _pipe().process("").tokens == []


def test_token_indexes_are_contiguous():
    lemmas = _table(
        ଘର=OdiaLemma(headword="ଘର", pos="NOUN"),
        ବହି=OdiaLemma(headword="ବହି", pos="NOUN"),
    )
    result = _pipe(lemmas).process("ଘର ବହି ଘର")
    assert [t.idx for t in result.tokens] == [0, 1, 2]


def test_known_lemma_exact_match_is_not_oov_and_not_ambiguous():
    lemmas = _table(ଘର=OdiaLemma(headword="ଘର", pos="NOUN", gloss="house"))
    result = _pipe(lemmas).process("ଘର")
    tok = result.tokens[0]
    assert tok.is_oov is False
    assert tok.is_ambiguous is False
    assert tok.is_word is True
    assert len(tok.candidates) == 1
    assert tok.candidates[0].lemma == "ଘର"
    assert tok.candidates[0].pos == "NOUN"


def test_unknown_surface_is_oov_with_fallback_candidate():
    # Empty lemma table → every input is OOV. The pipeline must still
    # emit a fallback LemmaCandidate so the reader pop-up has something
    # to show rather than a crash.
    result = _pipe().process("ଫ୍ଲର୍ବ")
    tok = result.tokens[0]
    assert tok.is_oov is True
    assert tok.is_ambiguous is False
    assert tok.candidates[0].lemma == "ଫ୍ଲର୍ବ"
    assert tok.candidates[0].pos == "X"
    # UPOS=X is treated as a word (code-switch) rather than punctuation.
    assert tok.is_word is True


def test_latin_only_surface_is_plain_text_not_oov_word():
    lemmas = _table(ଘର=OdiaLemma(headword="ଘର", pos="NOUN", gloss="house"))
    result = _pipe(lemmas).process("Edit ଘର")
    english, odia = result.tokens
    assert english.surface == "Edit"
    assert english.is_word is False
    assert english.is_oov is False
    assert english.candidates[0].pos == "X"
    assert odia.is_word is True
    assert odia.is_oov is False


def test_inflected_noun_strips_to_known_stem():
    # Locative suffix "ରେ" on ଘର → lemma ଘର with Case=Loc.
    lemmas = _table(ଘର=OdiaLemma(headword="ଘର", pos="NOUN"))
    result = _pipe(lemmas).process("ଘରରେ")
    tok = result.tokens[0]
    assert tok.is_oov is False
    assert tok.candidates[0].lemma == "ଘର"
    assert tok.candidates[0].features == {"Case": "Loc"}


def test_multiple_analyses_set_is_ambiguous():
    # The genitive suffix "ର" produces a strip-candidate for any NOUN
    # whose stem is also in the table. Adding a NOUN entry for "ଘରର"
    # itself (uninflected) creates genuine ambiguity between the
    # exact-match and the stripped reading.
    lemmas = _table(
        ଘର=OdiaLemma(headword="ଘର", pos="NOUN"),
        ଘରର=OdiaLemma(headword="ଘରର", pos="NOUN"),
    )
    result = _pipe(lemmas).process("ଘରର")
    tok = result.tokens[0]
    assert tok.is_ambiguous is True
    assert len(tok.candidates) == 2
    # Uniform score distribution across equally-plausible analyses.
    assert all(abs(c.score - 0.5) < 1e-9 for c in tok.candidates)


def test_punctuation_is_not_a_word_and_not_oov():
    result = _pipe().process("ନମସ୍କାର ।")
    words = result.tokens
    assert len(words) == 2
    # First token is OOV (empty lemma table) but is a word.
    assert words[0].is_word is True
    assert words[0].is_oov is True
    # Danda punctuation: is_word=False, is_oov=False (matches Stanza path).
    assert words[1].surface == "।"
    assert words[1].is_word is False
    assert words[1].is_oov is False
    assert words[1].candidates[0].pos == "PUNCT"


def test_drops_empty_surfaces_from_tokenizer():
    def fake_tokenizer(_text: str) -> list[str]:
        return ["ଘର", "", "ବହି"]

    lemmas = _table(
        ଘର=OdiaLemma(headword="ଘର", pos="NOUN"),
        ବହି=OdiaLemma(headword="ବହି", pos="NOUN"),
    )
    result = _pipe(lemmas=lemmas, tokenizer=fake_tokenizer).process("x")
    assert [t.surface for t in result.tokens] == ["ଘର", "ବହି"]


def test_tokenizer_is_called_with_raw_input():
    seen: list[str] = []

    def capture(text: str) -> list[str]:
        seen.append(text)
        return text.split()

    _pipe(tokenizer=capture).process("ନମସ୍କାର ଦୁନିଆ")
    assert seen == ["ନମସ୍କାର ଦୁନିଆ"]


def test_seed_lemma_table_resolves_canned_smoke_test_words():
    # The /process smoke test for Odia passes "ନମସ୍କାର ଦୁନିଆ" — both
    # words are in the shipped seed. Regression guard so a seed edit
    # that accidentally drops one of these doesn't silently break the
    # smoke test (or, worse, let it pass with both words marked OOV).
    from app.pipelines.odia.lemmas import default_lemma_table

    seed = default_lemma_table()
    assert seed.lookup("ନମସ୍କାର") is not None
    assert seed.lookup("ଦୁନିଆ") is not None
