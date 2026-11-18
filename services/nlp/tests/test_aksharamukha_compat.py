"""Exercise the Python 3.14 import failure in a fresh interpreter on every CI version."""

import subprocess
import sys


def test_import_without_ast_str_preserves_stdlib_and_hindi_romanization():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import ast
vars(ast).pop('Str', None)
from app.romanize import to_roman
assert not hasattr(ast, 'Str'), 'Compatibility alias leaked into stdlib'
assert to_roman('भारत', from_script='Deva', to_scheme='iso15919', language='hi') == 'bhārat'
""",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
