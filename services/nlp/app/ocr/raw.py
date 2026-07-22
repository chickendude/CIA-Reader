"""Raw (language-pipeline-free) tokenization for the transcription
workbench's scan OCR.

Dictionary scan pages mix scripts (English glosses beside Devanagari or
Odia headwords), so no single language pipeline fits — and the
workbench doesn't want lemma candidates anyway, just the OCR text with
word-level boxes so the UI can highlight and prefill. ``raw_tokenize``
produces the minimal ``Token`` list that :func:`app.ocr.align.
assign_token_boxes` can align: whitespace-split surfaces, ``is_word``
when the surface carries any letter or digit, no candidates and no
romanization.
"""

from __future__ import annotations

from app.schemas import Token


def _is_wordlike(surface: str) -> bool:
    return any(ch.isalnum() for ch in surface)


def raw_tokenize(text: str) -> list[Token]:
    """Whitespace-split ``text`` into pipeline-free tokens.

    The forward scan in ``assign_token_boxes`` finds each surface with
    ``text.find(surface, cursor)``, which succeeds by construction for
    whitespace-split surfaces taken in order.
    """
    tokens: list[Token] = []
    for surface in text.split():
        tokens.append(
            Token(
                idx=len(tokens),
                surface=surface,
                is_word=_is_wordlike(surface),
                is_oov=True,
            )
        )
    return tokens
