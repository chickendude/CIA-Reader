"""Conservative Unicode normalization with original character offsets."""

from dataclasses import asdict, dataclass
import unicodedata as ud

NORMALIZATION_VERSION = "nfc-joiners-v1"
JOINERS = "\u200c\u200d\ufeff"


def normalize(text: str) -> str:
    # NFC canonicalizes precomposed/decomposed nukta letters; nukta is retained.
    return ud.normalize("NFC", text.translate(dict.fromkeys(map(ord, JOINERS))))


@dataclass(frozen=True)
class Token:
    start: int
    end: int
    surface: str
    normalized: str
    kind: str
    sentence: int

    def to_dict(self):
        return asdict(self)


def tokenize(text: str) -> list[Token]:
    tokens = []
    i = sentence = 0
    while i < len(text):
        c = text[i]
        if c.isspace() or c in JOINERS:
            if c == "\n":
                sentence += 1
            i += 1
            continue
        start = i
        category = ud.category(c)[0]
        if category in "LMN":
            i += 1
            while i < len(text) and (ud.category(text[i])[0] in "LMN" or text[i] in JOINERS):
                i += 1
            surface = text[start:i]
            normalized = normalize(surface)
            letters = [x for x in normalized if ud.category(x).startswith("L")]
            if not letters and any(x.isnumeric() for x in normalized):
                kind = "number"
            elif letters and all("DEVANAGARI" in ud.name(x, "") for x in letters):
                kind = "word"
            else:
                kind = "foreign"
        else:
            i += 1
            surface = normalized = c
            kind = "punctuation" if category == "P" else "symbol"
        tokens.append(Token(start, i, surface, normalized, kind, sentence))
        if c in "।॥.!?":
            sentence += 1
    return tokens


def context(text: str, tokens: list[Token], index: int) -> str:
    sentence = tokens[index].sentence
    left = right = index
    while left and tokens[left - 1].sentence == sentence:
        left -= 1
    while right + 1 < len(tokens) and tokens[right + 1].sentence == sentence:
        right += 1
    return text[tokens[left].start:tokens[right].end]
