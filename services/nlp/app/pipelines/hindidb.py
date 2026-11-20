"""Match Hindi words and phrases against entries in Parhiba's editable dictionary."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from app.numbers import number_forms
from app.romanize import to_roman
from app.schemas import LemmaCandidate, Token
from hindidb.parser import PARSER_VERSION, analyze
from parhiba_hindi.database import DatabaseLexicon

from .dictionary import DictionaryPassage, DictionaryPipeline


@lru_cache(maxsize=100_000)
def _romanize(surface):
    return to_roman(surface, from_script="Deva", to_scheme="iso15919", language="hi")


class HindiDBPipeline(DictionaryPipeline):
    def __init__(self, provider=None):
        super().__init__("hi")
        self.provider = provider or DatabaseLexicon()

    def match_passage(self, text: str) -> DictionaryPassage:
        lexicon, ids, revision = self.provider.load()
        analysis = analyze(text, lexicon)
        tokens = []
        source_to_output = {}
        cursor = 0
        number_spans = {m.start(): m for m in re.finditer(r"[+−-]?\d+(?:\.\d+)?%?", text)}
        for index, source in enumerate(analysis["tokens"]):
            if source["start"] < cursor:
                source_to_output[index] = len(tokens) - 1
                continue
            if source["start"] > cursor:
                tokens.append(
                    Token(idx=len(tokens), surface=text[cursor : source["start"]], is_word=False)
                )
            source_to_output[index] = len(tokens)
            numeric = number_spans.get(source["start"])
            if numeric and source["kind"] in ("number", "punctuation", "symbol"):
                reading = number_forms(numeric.group().removesuffix("%"))
                if reading and numeric.group().endswith("%"):
                    reading.hi.spelled += " प्रतिशत"
                    reading.hi.romanized += " " + _romanize("प्रतिशत")
                    reading.digits_latin += "%"
                    reading.digits_deva += "%"
                    reading.digits_orya += "%"
                tokens.append(
                    Token(
                        idx=len(tokens),
                        surface=numeric.group(),
                        is_word=False,
                        sentence_idx=source["sentence"],
                        number_forms=reading,
                    )
                )
                cursor = numeric.end()
                continue
            tokens.append(
                Token(
                    idx=len(tokens),
                    surface=source["surface"],
                    is_word=source["kind"] == "word",
                    sentence_idx=source["sentence"],
                    is_oov=source["kind"] == "word",
                    number_forms=number_forms(source["surface"])
                    if source["kind"] == "number"
                    else None,
                )
            )
            cursor = source["end"]
        if cursor < len(text):
            tokens.append(Token(idx=len(tokens), surface=text[cursor:], is_word=False))
        occurrences = []
        matches = []
        for occurrence in analysis["occurrences"]:
            entry = lexicon.entries[occurrence["entry_id"]]
            start = source_to_output[occurrence["token_start"]]
            end = source_to_output[occurrence["token_end"] - 1] + 1
            uid = ids[occurrence["entry_id"]]
            occurrences.append(
                {
                    "start_idx": start,
                    "end_idx": end,
                    "lemma_id": uid,
                    "source_start": occurrence["start"],
                    "source_end": occurrence["end"],
                    "rules": occurrence["rules"],
                }
            )
            matches.append(
                (
                    start,
                    end,
                    LemmaCandidate(
                        lemma=entry["lemma"],
                        pos=entry["pos"],
                        score=1,
                        features={},
                        dictionary_id=uid,
                    ),
                )
            )
        payload: dict[str, Any] = {
            "revision": revision,
            "parser_version": PARSER_VERSION,
            "lexicon_fingerprint": analysis["lexicon_fingerprint"],
            "stats": analysis["stats"],
            "occurrences": occurrences,
            "constructions": analysis["constructions"],
        }
        return DictionaryPassage(
            tokens, {t.idx for t in tokens if t.is_word}, matches, analysis=payload
        )


def build_hindidb_pipeline():
    return HindiDBPipeline()
