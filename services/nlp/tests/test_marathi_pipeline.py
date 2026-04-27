"""Unit tests for :class:`app.pipelines.marathi.MarathiPipeline` (T-2.3).

The tokenization / lemma / POS / feature shaping is shared with Hindi
and already covered by ``test_hindi_pipeline.py``; this file focuses on
the Marathi-specific pieces:

- The ``pipeline_id`` is the canonical ``stanza-mr`` string.
- The IndicNLP fallback fires when Stanza yields zero tokens for
  non-empty input, and only then.
- Fallback tokens are marked OOV for content, not for punctuation,
  mirroring the Stanza path's is_oov rule.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from app.pipelines.marathi import MarathiPipeline


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
    def __init__(self, doc: FakeDoc) -> None:
        self._doc = doc

    def __call__(self, text: str) -> FakeDoc:
        return self._doc


def _track_calls() -> tuple[list[str], Callable[[str], list[str]]]:
    calls: list[str] = []

    def _tokenize(text: str) -> list[str]:
        calls.append(text)
        return text.split()

    return calls, _tokenize


def test_pipeline_id_is_stanza_mr():
    calls, fb = _track_calls()
    pipe = MarathiPipeline(
        nlp=FakeStanza(FakeDoc(sentences=[FakeSentence(words=[FakeWord("एक")])])),
        fallback_tokenizer=fb,
    )
    assert pipe.process("x").pipeline_id == "stanza-mr"
    # Stanza produced tokens, so fallback never ran.
    assert calls == []


def test_fallback_does_not_fire_when_stanza_returns_tokens():
    calls, fb = _track_calls()
    doc = FakeDoc(
        sentences=[FakeSentence(words=[FakeWord(text="बोलतो", lemma="बोलणे", upos="VERB")])]
    )
    pipe = MarathiPipeline(nlp=FakeStanza(doc), fallback_tokenizer=fb)
    result = pipe.process("बोलतो")
    assert calls == []
    assert len(result.tokens) == 1
    assert result.tokens[0].candidates[0].lemma == "बोलणे"


def test_fallback_does_not_fire_on_whitespace_only_input():
    # Whitespace-only is legitimately empty — we shouldn't synthesize
    # tokens from it via the fallback just because Stanza also returned
    # nothing.
    calls, fb = _track_calls()
    pipe = MarathiPipeline(nlp=FakeStanza(FakeDoc(sentences=[])), fallback_tokenizer=fb)
    result = pipe.process("   \t\n  ")
    assert calls == []
    assert result.tokens == []


def test_fallback_fires_when_stanza_returns_empty_for_non_empty_input():
    # The failure mode the fallback exists to cover: Stanza's mr model
    # emitting zero tokens (via zero sentences) for a short / informal
    # input where IndicNLP would tokenize fine.
    calls, fb = _track_calls()
    pipe = MarathiPipeline(nlp=FakeStanza(FakeDoc(sentences=[])), fallback_tokenizer=fb)
    result = pipe.process("नमस्कार जग")
    assert calls == ["नमस्कार जग"]
    assert [t.surface for t in result.tokens] == ["नमस्कार", "जग"]
    # Fallback tokens are all content (UPOS=X) and OOV.
    assert all(t.is_word for t in result.tokens)
    assert all(t.is_oov for t in result.tokens)
    assert all(t.candidates[0].pos == "X" for t in result.tokens)
    assert all(t.candidates[0].lemma == t.surface for t in result.tokens)


def test_fallback_preserves_token_indexes():
    calls, fb = _track_calls()
    pipe = MarathiPipeline(nlp=FakeStanza(FakeDoc(sentences=[])), fallback_tokenizer=fb)
    result = pipe.process("एक दोन तीन")
    assert [t.idx for t in result.tokens] == [0, 1, 2]


def test_fallback_marks_punctuation_correctly():
    # Devanagari danda (।) and a Latin full stop should both be
    # recognized as punctuation by the fallback tagger, mirroring the
    # is_word / is_oov contract used by the Stanza path.
    def fb(text: str) -> list[str]:
        return ["नमस्कार", "।", "."]

    pipe = MarathiPipeline(nlp=FakeStanza(FakeDoc(sentences=[])), fallback_tokenizer=fb)
    result = pipe.process("नमस्कार ।")
    assert [t.surface for t in result.tokens] == ["नमस्कार", "।", "."]
    assert result.tokens[0].is_word is True
    assert result.tokens[0].is_oov is True
    # Punctuation: is_word=False, is_oov=False
    assert result.tokens[1].is_word is False
    assert result.tokens[1].is_oov is False
    assert result.tokens[2].is_word is False
    assert result.tokens[2].is_oov is False


def test_fallback_drops_empty_surfaces():
    # A fallback tokenizer that returns stray empty strings (e.g. because
    # IndicNLP split on a trailing newline) shouldn't emit empty tokens —
    # those are illegal in the Token schema (surface is non-empty).
    def fb(_text: str) -> list[str]:
        return ["एक", "", "दो"]

    pipe = MarathiPipeline(nlp=FakeStanza(FakeDoc(sentences=[])), fallback_tokenizer=fb)
    result = pipe.process("whatever")
    assert [t.surface for t in result.tokens] == ["एक", "दो"]


def test_marathi_pipeline_reuses_stanza_output_shaping():
    # Sanity check: when Stanza does produce tokens, the result looks
    # identical in shape to Hindi — same LemmaCandidate, same UPOS-driven
    # is_word / is_oov rules. Regression guard so MarathiPipeline doesn't
    # silently diverge from StanzaUDPipeline.
    calls, fb = _track_calls()
    doc = FakeDoc(
        sentences=[
            FakeSentence(
                words=[
                    FakeWord(text="माझे", lemma="माझे", upos="PRON", feats="Number=Sing"),
                    FakeWord(text="।", lemma="।", upos="PUNCT"),
                ]
            )
        ]
    )
    pipe = MarathiPipeline(nlp=FakeStanza(doc), fallback_tokenizer=fb)
    result = pipe.process("माझे ।")
    assert result.tokens[0].candidates[0].features == {"Number": "Sing"}
    assert result.tokens[0].is_oov is True  # PRON + lemma==surface
    assert result.tokens[1].is_word is False
    assert result.tokens[1].is_oov is False
