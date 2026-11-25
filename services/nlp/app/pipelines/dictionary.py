"""Match words against root entries and their saved forms in the reader's dictionary."""

from __future__ import annotations

import os
import unicodedata
from collections import defaultdict
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from functools import lru_cache

import psycopg
import regex

from app.languages import LANGUAGES
from app.numbers import number_forms
from app.romanize import to_roman
from app.schemas import LemmaCandidate, Token
from parhiba_dictionary.matching import matching_prefixes

from .base import Pipeline, PipelineResult

# Keep joining marks inside words, including pointed Hebrew and Devanagari conjuncts.
_TOKENS = regex.compile(
    r"(?P<word>\p{L}[\p{L}\p{M}\u200c\u200d]*(?:[-'’־׳״]\p{L}[\p{L}\p{M}\u200c\u200d]*)*)"
    r"|(?P<number>[+−-]?\d+(?:[.,]\d+)*)|\s+|."
)


# Dictionary readings can change. Only reuse the transliterator's generated word readings.
_generated_reading = lru_cache(maxsize=32_768)(to_roman)


def saved_matches(language: str, spellings: list[str]):
    """Read current entries once per passage so edits apply on the next lookup."""
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        return conn.execute(
            """
            WITH matches AS (
                SELECT lower(normalize(l.headword)) AS spelling, l.id, l.headword, l.pos,
                       '{}'::jsonb AS features, NULL::text AS reading, 2 AS priority
                FROM lemmas l WHERE l.language = %(language)s
                  AND (lower(normalize(l.headword)) = ANY(%(words)s)
                       OR (strpos(l.headword,' ')>0 AND
                           split_part(lower(normalize(l.headword)), ' ', 1) = ANY(%(words)s)))
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
                  AND (lower(normalize(f.surface)) = ANY(%(words)s)
                       OR (strpos(f.surface,' ')>0 AND
                           split_part(lower(normalize(f.surface)), ' ', 1) = ANY(%(words)s)))
                UNION ALL
                SELECT lower(normalize(f.surface)), l.id, l.headword, l.pos, '{}'::jsonb, NULL, 2
                FROM dictionary_pattern_forms f JOIN lemmas l ON l.id=f.lemma_id
                WHERE l.language = %(language)s
                  AND split_part(lower(normalize(f.surface)), ' ', 1) = ANY(%(words)s)
                UNION ALL
                SELECT lower(normalize(o.surface_nfc)), l.id, l.headword, l.pos,
                       '{}'::jsonb, NULL, 0
                FROM form_lemma_overrides o JOIN lemmas l ON l.id = o.chosen_lemma_id
                WHERE o.language = %(language)s AND l.language = o.language
                  AND o.context_signature = '' AND lower(normalize(o.surface_nfc)) = ANY(%(words)s)
            )
            SELECT spelling, id, headword, pos, features, reading, priority FROM matches
            WHERE NOT EXISTS (
                SELECT 1 FROM dictionary_entries e,
                   LATERAL jsonb_array_elements_text(e.entry->'excluded_forms') excluded(surface)
                WHERE e.lemma_id = matches.id AND lower(normalize(excluded.surface)) = spelling
            )
            ORDER BY spelling, priority, id, reading NULLS LAST, features
            """,
            {"language": language, "words": spellings},
        ).fetchall()


@dataclass
class DictionaryPassage:
    tokens: list[Token]
    word_indices: Collection[int]
    # Spans use the reader's token indices, with an exclusive end.
    matches: Iterable[tuple[int, int, LemmaCandidate]]
    readings: dict[str, str] = field(default_factory=dict)
    analysis: dict | None = None


class DictionaryPipeline(Pipeline):
    def __init__(self, language: str):
        self.language = language
        self.descriptor = LANGUAGES[language]
        self.pipeline_id = self.descriptor.pipeline_id
        self.script = regex.compile(rf"\p{{Script={self.descriptor.script}}}")

    def process(self, text: str) -> PipelineResult:
        passage = self.match_passage(text)
        tokens = passage.tokens
        for start, end, candidate in passage.matches:
            if end > start + 1:
                candidate = candidate.model_copy(
                    update={"features": {**candidate.features, "Compound": "Yes"}}
                )
            choices = tokens[start].candidates
            if candidate not in choices:
                choices.append(candidate)
            for index in range(start, end):
                if index in passage.word_indices:
                    tokens[index].is_word = True
                    tokens[index].is_oov = False

        for token in tokens:
            if not token.is_word:
                continue
            token.is_ambiguous = len(token.candidates) > 1
            key = unicodedata.normalize("NFC", token.surface).lower()
            if key not in passage.readings and self.descriptor.default_romanization:
                # A pasted run without spaces can be as long as the entire chapter.
                convert = _generated_reading if len(token.surface) <= 128 else to_roman
                passage.readings[key] = convert(
                    token.surface,
                    from_script=self.descriptor.script,
                    to_scheme=self.descriptor.default_romanization,
                    language=self.language,
                )
            token.romanization = passage.readings.get(key)
        return PipelineResult(self.pipeline_id, tokens, hindi_analysis=passage.analysis)

    def match_passage(self, text: str) -> DictionaryPassage:
        tokens = []
        words = defaultdict(list)
        sentence = 0
        for match in _TOKENS.finditer(text):
            surface = match.group()
            word = match.lastgroup == "word" and bool(self.script.search(surface))
            token = Token(
                idx=len(tokens), sentence_idx=sentence, surface=surface, is_word=word, is_oov=word
            )
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

        trie = {}
        for spelling, candidates in matches.items():
            node = trie
            for part in spelling.split():
                node = node.setdefault(part, {})
            # Keep the database's candidate priority within each spelling.
            node[None] = list(candidates.values())

        keys = {token.idx: key for key, group in words.items() for token in group}

        def passage_words(start):
            index = start
            while index in keys:
                yield index, keys[index]
                if index + 1 >= len(tokens) or not tokens[index + 1].surface.isspace():
                    break
                index += 2
                if index >= len(tokens) or tokens[index].sentence_idx != tokens[start].sentence_idx:
                    break

        def matched_spans():
            for start in keys:
                for end, candidates, _ in matching_prefixes(trie, passage_words(start)):
                    for candidate in candidates:
                        yield start, end + 1, candidate

        return DictionaryPassage(tokens, keys.keys(), matched_spans(), readings)
