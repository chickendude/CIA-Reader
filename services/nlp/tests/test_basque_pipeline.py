"""Unit tests for :class:`app.pipelines.basque.BasquePipeline`.

Like the Hindi/Marathi pipeline tests, these inject a minimal fake
Stanza-like object so we exercise the pipeline's output-shaping logic
without the ~600MB UD_Basque-BDT model. The focus here is the all-caps
lemma-repair pass (see ``_is_allcaps_word`` / ``_relemmatize_lower`` in
``app.pipelines.stanza_ud``): Stanza's character seq2seq fallback mangles
all-caps words ("HITZAURREA" → "hitzaure"), so the pipeline re-lemmatizes
a lowercased copy and adopts that lemma for genuine lexical words.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.pipelines.basque import BasquePipeline
from app.pipelines.stanza_ud import _is_allcaps_word


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


# --- _is_allcaps_word ---------------------------------------------------


def test_is_allcaps_word_true_for_multiletter_uppercase():
    assert _is_allcaps_word("HITZAURREA") is True
    assert _is_allcaps_word("EZ") is True


def test_is_allcaps_word_false_for_title_and_lower_case():
    assert _is_allcaps_word("Hitzaurrea") is False
    assert _is_allcaps_word("hitzaurrea") is False


def test_is_allcaps_word_false_for_single_letter_and_non_letters():
    assert _is_allcaps_word("A") is False
    assert _is_allcaps_word("123") is False
    assert _is_allcaps_word("") is False


# --- all-caps lemma repair ---------------------------------------------


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


def test_title_case_word_is_not_re_lemmatized():
    pipe, fake = _pipe({"Hitzaurrea": [("Hitzaurrea", "hitzaurre", "NOUN")]})
    [tok] = _word_tokens(pipe.process("Hitzaurrea"))
    assert tok.candidates[0].lemma == "hitzaurre"
    # No lowercased re-run — title case already lemmatizes correctly.
    assert fake.calls == ["Hitzaurrea"]


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
