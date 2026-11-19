"""Match words against root entries and their saved forms in the reader's dictionary."""

from __future__ import annotations

import os
import unicodedata
from collections import defaultdict

import psycopg
import regex

from app.languages import LANGUAGES
from app.numbers import number_forms
from app.romanize import to_roman
from app.schemas import LemmaCandidate, Token

from .base import Pipeline, PipelineResult

# Keep joining marks inside words, including pointed Hebrew and Devanagari conjuncts.
_TOKENS = regex.compile(
    r"(?P<word>\p{L}[\p{L}\p{M}\u200c\u200d]*(?:[-'’־׳״]\p{L}[\p{L}\p{M}\u200c\u200d]*)*)"
    r"|(?P<number>[+−-]?\d+(?:[.,]\d+)*)|\s+|."
)
_SCRIPTS = {
    "Latn": regex.compile(r"\p{Script=Latin}"),
    "Deva": regex.compile(r"\p{Script=Devanagari}"),
    "Hebr": regex.compile(r"\p{Script=Hebrew}"),
    "Orya": regex.compile(r"\p{Script=Oriya}"),
}


def saved_matches(language: str, spellings: list[str]):
    """Read current entries once per passage so edits apply on the next lookup."""
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        return conn.execute(
            """
            WITH matches AS (
                SELECT lower(normalize(l.headword)) AS spelling, l.id, l.headword, l.pos,
                       '{}'::jsonb AS features, NULL::text AS reading, 2 AS priority
                FROM lemmas l WHERE l.language = %(language)s
                  AND lower(normalize(l.headword)) = ANY(%(words)s)
                  AND (l.source_attribution IS DISTINCT FROM 'Stanza UD' OR l.curator_locked
                       OR l.gloss_default IS NOT NULL
                       OR EXISTS (SELECT 1 FROM lemma_forms f WHERE f.lemma_id = l.id
                                  AND f.quarantined_at IS NULL)
                       OR EXISTS (SELECT 1 FROM translations t WHERE t.target_type = 'lemma'
                                  AND t.target_id = l.id AND NOT t.hidden AND NOT t.is_private))
                UNION ALL
                SELECT lower(normalize(f.surface)), l.id, l.headword, l.pos,
                       f.features, f.romanization, 1
                FROM lemma_forms f JOIN lemmas l ON l.id = f.lemma_id
                WHERE l.language = %(language)s AND f.quarantined_at IS NULL
                  AND lower(normalize(f.surface)) = ANY(%(words)s)
                UNION ALL
                SELECT lower(normalize(o.surface_nfc)), l.id, l.headword, l.pos,
                       '{}'::jsonb, NULL, 0
                FROM form_lemma_overrides o JOIN lemmas l ON l.id = o.chosen_lemma_id
                WHERE o.language = %(language)s AND l.language = o.language
                  AND o.context_signature = '' AND lower(normalize(o.surface_nfc)) = ANY(%(words)s)
            )
            SELECT spelling, id, headword, pos, features, reading, priority FROM matches
            ORDER BY spelling, priority, id, reading NULLS LAST, features
            """,
            {"language": language, "words": spellings},
        ).fetchall()


class DictionaryPipeline(Pipeline):
    def __init__(self, language: str):
        self.language = language
        self.descriptor = LANGUAGES[language]
        self.pipeline_id = self.descriptor.pipeline_id

    def process(self, text: str) -> PipelineResult:
        tokens = []
        words = defaultdict(list)
        sentence = 0
        for match in _TOKENS.finditer(text):
            surface = match.group()
            word = match.lastgroup == "word" and bool(
                _SCRIPTS[self.descriptor.script].search(surface)
            )
            token = Token(idx=len(tokens), sentence_idx=sentence, surface=surface, is_word=word)
            tokens.append(token)
            if match.lastgroup == "word":
                words[unicodedata.normalize("NFC", surface).lower()].append(token)
            elif match.lastgroup == "number":
                token.number_forms = number_forms(surface)
            if surface in (".", "!", "?", "।", "॥") or "\n" in surface:
                sentence += 1

        matches = defaultdict(dict)
        readings = {}
        overrides = {}
        for key, uid, root, pos, features, reading, priority in (
            saved_matches(self.language, list(words)) if words else []
        ):
            if priority == 0:
                overrides.setdefault(key, uid)
            if key in overrides and overrides[key] != uid:
                continue
            if uid not in matches[key] or (priority == 1 and not matches[key][uid].features):
                matches[key][uid] = LemmaCandidate(
                    dictionary_id=str(uid),
                    lemma=root,
                    pos=pos,
                    features=features,
                    score=1,
                )
            if reading:
                readings.setdefault(key, reading)

        for key, occurrences in words.items():
            candidates = list(matches[key].values())
            if not candidates and not occurrences[0].is_word:
                continue
            reading = readings.get(key)
            if not reading and self.descriptor.default_romanization:
                reading = to_roman(
                    occurrences[0].surface,
                    from_script=self.descriptor.script,
                    to_scheme=self.descriptor.default_romanization,
                    language=self.language,
                )
            for token in occurrences:
                token.is_word = True
                token.candidates = candidates
                token.is_oov = not candidates
                token.is_ambiguous = len(candidates) > 1
                token.romanization = reading
        return PipelineResult(self.pipeline_id, tokens)
