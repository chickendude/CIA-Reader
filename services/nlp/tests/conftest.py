"""Shared test fixtures.

Two concerns:

1. Make the shared language registry importable. In Docker we mount
   ``packages/shared-types/python`` at ``/opt/shared-types`` and add it
   to ``PYTHONPATH``. In local ``pytest`` runs we do the same from the
   repo layout.

2. Stub out the real Hindi Stanza factory. Production ``stanza-hi``
   lazy-imports Stanza and loads a ~600MB UD model. CI doesn't install
   stanza at all (it lives in the ``models`` optional-dependencies
   group, not the default dev deps), so any test that ends up calling
   :func:`app.pipelines.get_pipeline("hi")` needs a substitute factory.
   The autouse fixture below swaps ``stanza-hi`` for one that builds a
   :class:`HindiPipeline` wrapped around a tiny whitespace fake.
   Dedicated Hindi-pipeline tests build richer fakes inline rather than
   extending this one.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

_HERE = Path(__file__).resolve()
# services/nlp/tests/conftest.py -> repo root
_REPO_ROOT = _HERE.parent.parent.parent.parent
_SHARED_PY = _REPO_ROOT / "packages" / "shared-types" / "python"

if str(_SHARED_PY) not in sys.path:
    sys.path.insert(0, str(_SHARED_PY))

os.environ.setdefault("PYTHONPATH", str(_SHARED_PY))

# The two imports below depend on shared-types already being on
# sys.path, so they must happen after the block above runs.
import pytest  # noqa: E402

from app import pipelines  # noqa: E402
from app.pipelines.hindi import HindiPipeline  # noqa: E402
from app.pipelines.marathi import MarathiPipeline  # noqa: E402


@dataclass
class _FakeWord:
    text: str
    lemma: str | None = None
    upos: str = "NOUN"
    feats: str | None = None

    def __post_init__(self) -> None:
        # Surface-as-lemma matches Stanza's "no dictionary match" behavior,
        # which the HindiPipeline uses as its OOV heuristic. Reasonable
        # default for a whitespace-only fallback fake.
        if self.lemma is None:
            self.lemma = self.text


@dataclass
class _FakeSentence:
    words: list[_FakeWord] = field(default_factory=list)


@dataclass
class _FakeDoc:
    sentences: list[_FakeSentence] = field(default_factory=list)


class _WhitespaceFakeStanza:
    """Whitespace-split, one sentence, NOUN UPOS, lemma = surface."""

    def __call__(self, text: str) -> _FakeDoc:
        surfaces = text.split()
        words = [_FakeWord(text=s) for s in surfaces]
        return _FakeDoc(sentences=[_FakeSentence(words=words)] if words else [])


def _fallback_split(text: str) -> list[str]:
    """Minimal fallback tokenizer used by the Marathi fake."""
    return text.split()


@pytest.fixture(autouse=True)
def _fake_stanza_factories():
    """Replace the real Stanza-backed factories with whitespace fakes.

    Applies to both ``stanza-hi`` (T-2.2) and ``stanza-mr`` (T-2.3).
    Dedicated tests for each pipeline still instantiate with their own
    fakes when they need specific UPOS / features / fallback behavior.
    """
    originals = {
        "stanza-hi": pipelines._PIPELINE_FACTORIES.get("stanza-hi"),
        "stanza-mr": pipelines._PIPELINE_FACTORIES.get("stanza-mr"),
    }

    def _hi_factory() -> HindiPipeline:
        return HindiPipeline(nlp=_WhitespaceFakeStanza())

    def _mr_factory() -> MarathiPipeline:
        return MarathiPipeline(
            nlp=_WhitespaceFakeStanza(),
            fallback_tokenizer=_fallback_split,
        )

    pipelines._PIPELINE_FACTORIES["stanza-hi"] = _hi_factory
    pipelines._PIPELINE_FACTORIES["stanza-mr"] = _mr_factory
    pipelines.reset_pipeline_cache()
    try:
        yield
    finally:
        for pipeline_id, original in originals.items():
            if original is None:
                pipelines._PIPELINE_FACTORIES.pop(pipeline_id, None)
            else:
                pipelines._PIPELINE_FACTORIES[pipeline_id] = original
        pipelines.reset_pipeline_cache()
