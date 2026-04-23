"""Make the shared language registry importable in tests.

In Docker we mount packages/shared-types/python at /opt/shared-types and add
it to PYTHONPATH. In local `pytest` runs, do the same from the repo layout.
"""

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
