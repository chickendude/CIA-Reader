"""Unit tests for :class:`app.pipelines.basque.BasquePipeline`.

Like the Hindi/Marathi pipeline tests, these inject a minimal fake
Stanza-like object so we exercise the pipeline's output-shaping logic
without the ~600MB UD_Basque-BDT model. The focus here is the case
lemma-repair pass (see ``_needs_lowercase_relemma`` / ``_relemmatize_lower``
in ``app.pipelines.stanza_ud``): Stanza's character seq2seq fallback
mangles non-lowercase words — dropping letters in all-caps headings
("HITZAURREA" → "hitzaure") and inserting an h in dialogue-initial
title-case words ("Ondo" → "hondo", #437) — so the pipeline re-lemmatizes
a lowercased copy and adopts that lemma for genuine lexical words. It also
covers the leading dialogue-dash split (#437).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.pipelines.basque import BasquePipeline
from app.pipelines.stanza_ud import _leading_split_mark, _needs_lowercase_relemma


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


class CasingFakeStanza:
    """Fake whose lemmatization depends on the *case* of the input.

    Mirrors how the real Basque model behaves: a normal-case word that
    hits the dictionary cache lemmatizes correctly, while an all-caps
    form misses the cache and the seq2seq fallback drops a letter. The
    ``table`` maps an exact input string to the ``(text, lemma, upos)``
    rows it should produce; unknown inputs fall back to one NOUN whose
    lemma equals the surface.
    """

    def __init__(self, table: dict[str, list[tuple[str, str, str]]]) -> None:
        self._table = table
        self.calls: list[str] = []

    def __call__(self, text: str) -> FakeDoc:
        self.calls.append(text)
        rows = self._table.get(text, [(text, text, "NOUN")])
        words = [FakeWord(text=t, lemma=lm, upos=up) for (t, lm, up) in rows]
        return FakeDoc(sentences=[FakeSentence(words=words)] if words else [])


def _pipe(table: dict[str, list[tuple[str, str, str]]]) -> tuple[BasquePipeline, CasingFakeStanza]:
    fake = CasingFakeStanza(table)
    return BasquePipeline(nlp=fake, script="Latn"), fake


def _word_tokens(result):
    return [t for t in result.tokens if t.is_word]


# --- _needs_lowercase_relemma ------------------------------------------


def test_needs_lowercase_relemma_true_for_uppercase_forms():
    # All-caps headings and title/dialogue-initial words both risk a
    # lowercase-cache miss, so both opt into the re-lemmatization pass.
    assert _needs_lowercase_relemma("HITZAURREA") is True
    assert _needs_lowercase_relemma("EZ") is True
    assert _needs_lowercase_relemma("Hitzaurrea") is True
    assert _needs_lowercase_relemma("Ondo") is True


def test_needs_lowercase_relemma_false_for_lowercase():
    assert _needs_lowercase_relemma("hitzaurrea") is False
    assert _needs_lowercase_relemma("ondo") is False


def test_needs_lowercase_relemma_false_for_single_letter_and_non_letters():
    assert _needs_lowercase_relemma("A") is False
    assert _needs_lowercase_relemma("123") is False
    assert _needs_lowercase_relemma("") is False


# --- _leading_split_mark -----------------------------------------------


def test_leading_split_mark_detects_glued_dialogue_dash():
    assert _leading_split_mark("–Ondo") == "–"  # en dash
    assert _leading_split_mark("—Ondo") == "—"  # em dash


def test_leading_split_mark_ignores_bare_dash_and_hyphen():
    # A standalone dash (Stanza already split it) and the ASCII
    # hyphen-minus (compounds, negative numbers) are left alone.
    assert _leading_split_mark("–") is None
    assert _leading_split_mark("-15") is None
    assert _leading_split_mark("kale-garbitzaile") is None


# --- case lemma repair -------------------------------------------------


def test_allcaps_lemma_is_repaired_from_lowercased_form():
    # All-caps input lemmatizes wrong; the lowercased form is correct.
    pipe, fake = _pipe(
        {
            "HITZAURREA": [("HITZAURREA", "hitzaure", "NOUN")],
            "hitzaurrea": [("hitzaurrea", "hitzaurre", "NOUN")],
        }
    )
    [tok] = _word_tokens(pipe.process("HITZAURREA"))
    # Surface is preserved as typed; the lemma is the repaired one.
    assert tok.surface == "HITZAURREA"
    assert tok.candidates[0].lemma == "hitzaurre"
    # The pipeline re-ran the model on the lowercased copy.
    assert "hitzaurrea" in fake.calls


def test_title_case_lemma_is_repaired_from_lowercased_form():
    # #437: a dialogue/sentence-initial title-case word misses Stanza's
    # lowercase lemma cache and the seq2seq fallback inserts an h
    # ("Ondo" → "hondo"). The lowercased form hits the cache and
    # lemmatizes correctly, so the pipeline adopts it.
    pipe, fake = _pipe(
        {
            "Ondo": [("Ondo", "hondo", "ADV")],
            "ondo": [("ondo", "ondo", "ADV")],
        }
    )
    [tok] = _word_tokens(pipe.process("Ondo"))
    assert tok.surface == "Ondo"
    assert tok.candidates[0].lemma == "ondo"
    assert "ondo" in fake.calls


def test_leading_dialogue_dash_is_split_and_word_relemmatized():
    # #437: "–Ondo" arrives as one glued token whose seq2seq lemma is
    # "hondo". The pipeline peels the en dash into its own non-word
    # token and re-lemmatizes the title-case word part from lowercase.
    pipe, fake = _pipe(
        {
            "–Ondo": [("–Ondo", "hondo", "ADV")],
            "ondo": [("ondo", "ondo", "ADV")],
        }
    )
    result = pipe.process("–Ondo")
    assert [t.surface for t in result.tokens] == ["–", "Ondo"]
    dash, word = result.tokens
    assert dash.is_word is False
    assert dash.candidates[0].pos == "PUNCT"
    assert word.is_word is True
    assert word.candidates[0].lemma == "ondo"
    assert "ondo" in fake.calls


def test_leading_dash_is_stripped_from_a_glued_lemma():
    # When Stanza returns the dash glued onto the lemma too ("–bai"), the
    # peel strips it from both surface and lemma. A PROPN skips the
    # case-repair pass, so the stripped lemma is what surfaces.
    pipe, _ = _pipe({"–Bai": [("–Bai", "–Bai", "PROPN")]})
    result = pipe.process("–Bai")
    assert [t.surface for t in result.tokens] == ["–", "Bai"]
    _, word = result.tokens
    assert word.candidates[0].lemma == "Bai"


def test_allcaps_proper_noun_lemma_is_left_alone():
    # PROPN keeps its capitalized lemma; no lowercased re-run happens.
    pipe, fake = _pipe({"BAIONA": [("BAIONA", "Baiona", "PROPN")]})
    [tok] = _word_tokens(pipe.process("BAIONA"))
    assert tok.candidates[0].lemma == "Baiona"
    assert fake.calls == ["BAIONA"]


def test_allcaps_repair_is_memoized_across_repeats():
    pipe, fake = _pipe(
        {
            "HITZAURREA HITZAURREA": [
                ("HITZAURREA", "hitzaure", "NOUN"),
                ("HITZAURREA", "hitzaure", "NOUN"),
            ],
            "hitzaurrea": [("hitzaurrea", "hitzaurre", "NOUN")],
        }
    )
    toks = _word_tokens(pipe.process("HITZAURREA HITZAURREA"))
    assert [t.candidates[0].lemma for t in toks] == ["hitzaurre", "hitzaurre"]
    # One full-text call + a single memoized lowercased re-run.
    assert fake.calls.count("hitzaurrea") == 1


def test_allcaps_repair_skipped_when_lowercase_resegments():
    # If the lowercased copy tokenizes into >1 word we keep the original
    # lemma rather than grafting one from a different segmentation.
    pipe, _ = _pipe(
        {
            "ETAB": [("ETAB", "etab", "NOUN")],
            "etab": [("eta", "eta", "CCONJ"), ("b", "b", "NOUN")],
        }
    )
    [tok] = _word_tokens(pipe.process("ETAB"))
    assert tok.candidates[0].lemma == "etab"
