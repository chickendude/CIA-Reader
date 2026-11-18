"""HindiDB recommendation and spelling previews using the current Parhiba lexicon."""
import hashlib
import json
import re

from .lexicon import lexical_id
from .morphology import forms
from .spelling import omitted_nukta_match
from .text import normalize, tokenize


def entry_hash(entry):
    return hashlib.sha256(json.dumps(entry, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


LABELS = {'components': 'Remove phrase; use components', 'keep': 'Keep phrase meaning',
          'base_first': 'Base needed first', 'sense_first': 'Meaning work first',
          'verify': 'Verify usage first', 'core': 'Keep core verb'}


def uncovered_form(entry, dependencies, core, lexicon):
    """Retiring a phrase must not hide a spelling only supported by that phrase."""
    base_ids = {e['id'] for e in dependencies}
    for form in forms(entry):
        tokens = tokenize(form)
        covered = any(base['id'] in base_ids and end + 1 < len(tokens) and
                      any(verb['id'] == core['id'] and last == len(tokens) - 1
                          for last, verb, _ in lexicon.matches(form, tokens, end + 1))
                      for end, base, _ in lexicon.matches(form, tokens, 0)) if tokens else False
        if not covered:
            return form
    return None


def recommendation_rows(lexicon, document):
    rows = []
    core = next((e['source_entry'] for e in document['entries'] if e['decision'] == 'core'), None)
    live_core = lexicon.entries.get(core.get('id')) if core else None
    for recommendation in document['entries']:
        key = recommendation['entry_id']
        current = lexicon.entries.get(key)
        decision = recommendation['decision']
        state, blocked = 'keep' if decision in {'keep', 'core'} else 'needs_work', ''
        dependencies = [c for c in recommendation.get('components', []) if c.get('pos') != 'PROPN']
        if current is None:
            state = 'removed'
        elif entry_hash(current) != entry_hash(recommendation['source_entry']):
            state, blocked = 'changed', 'Entry changed since this recommendation. Review it in the editor.'
        elif decision == 'components':
            state = 'ready'
            if current.get('group_id'):
                state, blocked = 'needs_work', 'Entry belongs to a group of POS uses. Review the group first.'
            elif not dependencies or not core or not live_core or entry_hash(core) != entry_hash(live_core):
                state, blocked = 'changed', 'The supporting base or core verb changed or is missing.'
            else:
                for dependency in dependencies:
                    live = lexicon.entries.get(dependency['id'])
                    if live is None or {field: live.get(field) for field in dependency} != dependency:
                        state, blocked = 'changed', 'A supporting base entry changed or is missing. Review it first.'
                        break
                if state == 'ready':
                    unsupported = uncovered_form(current, dependencies, core, lexicon)
                    if unsupported:
                        state, blocked = 'needs_work', f'Preserve this form under its components first: {unsupported}'
        rows.append({'id': key, 'lemma': recommendation['lemma'], 'pos': recommendation['pos'],
                     'decision': decision, 'recommendation': LABELS[decision], 'state': state,
                     'reason': recommendation['reason'], 'blocked': blocked,
                     'meaning': recommendation.get('meaning', ''),
                     'base': recommendation.get('base', ''),
                     'source_urls': recommendation.get('source_urls', []),
                     'current_hash': entry_hash(current) if current else None})
    return rows


REDIRECT = re.compile(
    r'^nuqtaless form of\s+([\u0900-\u097f]+(?:[ -][\u0900-\u097f]+)*)(?:\s*\([^)]*\))?[.!]?$', re.I)


def redirect_target(text):
    match = REDIRECT.fullmatch(text.strip())
    return normalize(match[1]) if match else None


def spelling_rows(lexicon):
    """Only unambiguous, pure redirects with an existing same-POS destination."""
    ready, skipped = [], []
    for source in sorted(lexicon.entries.values(), key=lambda e: (e['lemma'], e['pos'])):
        definitions = source.get('definitions', [])
        if not any('nuqtaless form of' in d.get('original', '').lower() for d in definitions):
            continue
        row = {'source_id': source['id'], 'lemma': source['lemma'], 'pos': source['pos']}
        targets = {redirect_target(d.get('original', '')) for d in definitions}
        reason = ''
        target = None
        if None in targets:
            reason = 'Has other meanings or an incomplete redirect'
        elif len(targets) != 1:
            reason = 'Refers to multiple headwords'
        else:
            headword = next(iter(targets))
            row['target_lemma'] = headword
            target = lexicon.entries.get(lexical_id(headword, source['pos']))
            if any(d.get('translation', '').strip() and redirect_target(d['translation']) != headword
                   for d in definitions):
                reason = 'Has a separately edited translation'
            elif target is None:
                reason = 'Main entry with the same part of speech is missing'
            elif not omitted_nukta_match(source['lemma'], headword):
                reason = 'Spelling differs by more than omitted nukta'
            elif not target.get('definitions') or any(
                    'nuqtaless form of' in d.get('original', '').lower() for d in target['definitions']):
                reason = 'Main entry has no definition or is itself a redirect'
            elif source.get('group_id'):
                reason = 'Belongs to a group of POS uses'
            elif source.get('excluded_forms') or target.get('excluded_forms'):
                reason = 'Has reviewed form exclusions'
        if reason:
            skipped.append({**row, 'reason': reason})
        else:
            ready.append({**row, 'target_id': target['id'],
                          'source_hash': entry_hash(source), 'target_hash': entry_hash(target)})
    # Includes skipped records and destination hashes: a stale preview cannot
    # quietly add newly eligible entries to a previously confirmed batch.
    result = {'ready': ready, 'skipped': skipped}
    return {**result, 'fingerprint': entry_hash(result)}


