"""Re-export the shared language registry under the app's import path.

The registry itself lives at packages/shared-types/python/languages.py and is
mounted into the container by docker-compose. In local (non-docker) runs we
also add that directory to sys.path via conftest.py.
"""

from languages import (  # type: ignore[import-not-found]
    LANGUAGES,
    SUPPORTED_LANGUAGE_CODES,
    LanguageDescriptor,
    get_language,
    is_supported_language,
)

__all__ = [
    "LANGUAGES",
    "SUPPORTED_LANGUAGE_CODES",
    "LanguageDescriptor",
    "get_language",
    "is_supported_language",
]
