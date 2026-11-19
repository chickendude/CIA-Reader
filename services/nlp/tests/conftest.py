"""Use small dictionaries for tests that exercise the service without PostgreSQL."""

from __future__ import annotations

import os
import sys
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
from app.pipelines import dictionary  # noqa: E402
from app.pipelines.hindidb import HindiDBPipeline  # noqa: E402
from hindidb.lexicon import Lexicon  # noqa: E402


@pytest.fixture(autouse=True)
def test_dictionary(monkeypatch):
    class SeedProvider:
        def load(self):
            lexicon = Lexicon()
            return lexicon, {key: key for key in lexicon.entries}, 1

    monkeypatch.setitem(
        pipelines._PIPELINE_FACTORIES, "hindidb-hi", lambda: HindiDBPipeline(SeedProvider())
    )
    monkeypatch.setattr(dictionary, "saved_matches", lambda language, spellings: [])
    pipelines.reset_pipeline_cache()
    yield
    pipelines.reset_pipeline_cache()
