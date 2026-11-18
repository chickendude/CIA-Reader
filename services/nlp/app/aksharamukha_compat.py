"""Load Aksharamukha 2.3 on Python 3.14 without a permanent stdlib patch.

Its PreProcess module imports ast.Str but never uses it. Python 3.14 removed
that deprecated name. Supply the replacement only while importing the library;
remove this workaround when upstream drops the unused import.
"""

import ast

_missing_str = not hasattr(ast, "Str")
if _missing_str:
    vars(ast)["Str"] = ast.Constant
try:
    from aksharamukha import transliterate
finally:
    if _missing_str:
        del vars(ast)["Str"]

__all__ = ["transliterate"]
