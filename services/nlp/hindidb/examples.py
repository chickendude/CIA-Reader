"""Example-relative, original-text spans, including compatibility with old snapshots."""


def add_card_examples(store, books, rows, *, allowed=None):
    """Choose three distinct attested sentences, preferring the citation spelling.

    Example ranking does not filter lexical candidates or change their counts.
    Named alternative headwords rank next, then other supported word forms. This
    keeps a dialectal spelling from supplying the card's example when the actual
    citation form occurs in the selected books.
    """
    from itertools import groupby
    from pathlib import Path
    from .reader import _snapshot
    from .text import normalize

    database = Path(store.db.execute('PRAGMA database_list').fetchone()[2]).resolve().as_uri()
    targets, selected = {}, {}
    for row in rows:
        row['extra_examples'] = []
        selected[row['entry_id']] = []
        for key in row.get('example_entry_ids', {row['entry_id'], *[use['id'] for use in row.get('group_uses', [])]}):
            targets[key] = row
    if not targets:
        return
    sequence = 0
    for book in books:
        snapshot = store.db.execute('''SELECT a.id,a.created_at FROM analyses a
            JOIN active_analyses aa ON aa.analysis_id=a.id
            WHERE aa.book_id=? AND a.created_at=?''', (book['id'], book['created_at'])).fetchone()
        if snapshot is None:
            raise ValueError('Book analysis changed. Find words again to refresh the deck.')
        text, tokens, occurrences, *_ = _snapshot(database, snapshot['id'], snapshot['created_at'])
        bounds = {}
        for token in tokens:
            bounds.setdefault(token['sentence'], [token['start'], token['end']])[1] = token['end']
        for sentence, matches in groupby(occurrences, key=lambda occurrence: occurrence['sentence']):
            examples = {}
            for occurrence in matches:
                if allowed is not None and (occurrence['start'], occurrence['end'], occurrence['entry_id']) not in allowed[book['id']]:
                    continue
                row = targets.get(occurrence['entry_id'])
                if row is None:
                    continue
                key = row['entry_id']
                start, end = bounds[sentence]
                example = examples.setdefault(key, {'example': text[start:end], 'example_spans': [],
                    'example_source_start': start, 'example_start': occurrence['start'],
                    'example_book': book['title'], 'book_id': book['id'], 'rank': 2})
                surface = normalize(text[occurrence['start']:occurrence['end']])
                rank = (0 if surface == normalize(row['lemma']) else 1
                        if surface in {normalize(word) for word in row.get('alternative_headwords', [])} else 2)
                example['rank'] = min(example['rank'], rank)
                span = [occurrence['start'] - start, occurrence['end'] - start]
                if span not in example['example_spans']:
                    example['example_spans'].append(span)
            for key, example in examples.items():
                sequence += 1
                example['order'] = sequence
                example['canonical'] = ' '.join(example['example'].split())
                existing = next((item for item in selected[key] if item['canonical'] == example['canonical']), None)
                if existing is not None:
                    if existing['rank'] <= example['rank']:
                        continue
                    selected[key].remove(existing)
                selected[key].append(example)
                selected[key].sort(key=lambda item: (item['rank'], item['order']))
                del selected[key][3:]
    for row in rows:
        examples = [{key: value for key, value in example.items() if key not in {'rank', 'order', 'canonical'}}
                    for example in selected[row['entry_id']]]
        if not examples:
            continue
        row.update({key: value for key, value in examples[0].items() if key != 'book_id'})
        row['extra_examples'] = examples[1:]


def add_example_spans(analysis):
    """Annotate examples using stored occurrences, never spelling substring guesses.

    Offsets are Python Unicode code points. Consumers using UTF-16 must convert.
    This also works on old stored reports without re-running the parser.
    """
    sentence_starts, token_sentences = {}, {}
    for token in analysis["tokens"]:
        sentence_starts.setdefault(token["sentence"], token["start"])
        token_sentences[token["start"]] = token["sentence"]
    rows = {row["entry_id"]: row for row in analysis["frequencies"]}
    first_sentences = {}
    for row in rows.values():
        row["example_spans"] = []
    for occurrence in analysis["occurrences"]:
        key = occurrence["entry_id"]
        sentence = first_sentences.setdefault(key, occurrence["sentence"])
        if occurrence["sentence"] != sentence:
            continue
        row = rows[key]
        start = sentence_starts[sentence]
        row["example_source_start"] = start
        span = [occurrence["start"] - start, occurrence["end"] - start]
        if span not in row["example_spans"]:
            row["example_spans"].append(span)
    for row in analysis["unresolved"]:
        offsets = row["offsets"]
        sentence = token_sentences[offsets[0][0]]
        start = sentence_starts[sentence]
        row["example_source_start"] = start
        row["example_spans"] = [[a - start, b - start] for a, b in offsets
                                if token_sentences[a] == sentence]
    return analysis
