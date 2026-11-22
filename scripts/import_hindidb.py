#!/usr/bin/env python3
"""Replace local Hindi dictionary data from HindiDB; dry-run unless --apply."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'services/nlp'), str(ROOT / 'packages/shared-types/python')]
from hindidb.lexicon import Lexicon
from psycopg import connect
from psycopg.types.json import Jsonb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    url = os.environ['DATABASE_URL']
    # Deliberately restrict this replacement tool to local development.
    from urllib.parse import urlparse
    if urlparse(url).hostname not in ('localhost', '127.0.0.1', '::1'):
        raise SystemExit('This tool only replaces a local database.')
    inputs = [args.source / 'hindidb/data/seed.json',
              args.source / '.hindidb/wiktionary-base.json', args.source / '.hindidb/lexicon.json']
    lexicon = Lexicon(inputs)
    entries = list(lexicon.entries.values())
    fingerprint = lexicon.fingerprint
    print(json.dumps({'active_entries': len(entries),
                      'definitions': sum(len(e.get('definitions', [])) for e in entries),
                      'explicit_forms': sum(len(set(e.get('forms', []))) for e in entries),
                      'fingerprint': fingerprint, 'apply': args.apply}, indent=2), flush=True)
    if not args.apply:
        return
    with connect(url) as conn:
        previous = conn.execute('SELECT metadata FROM hindi_dictionary_state WHERE id=1').fetchone()
        if previous:
            raise SystemExit('HindiDB was already imported. Edit it in Parhiba; refusing to overwrite subsequent edits.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = ROOT / '.local/backups' / f'before-hindidb-{stamp}.dump'
    backup.parent.mkdir(parents=True, exist_ok=True)
    with backup.open('xb') as stream:
        subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-privileges', '--dbname', url], stdout=stream, check=True)
    snapshot = ROOT / '.local/hindidb-source' / stamp
    snapshot.mkdir(parents=True)
    manifest = {}
    for index, path in enumerate(inputs):
        shutil.copyfile(path, snapshot / f'{index}-{path.name}')
        manifest[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    review_path = args.source / '.hindidb/review.sqlite3'
    if review_path.exists():
        with sqlite3.connect(review_path.resolve().as_uri() + '?mode=ro', uri=True) as src:
            with sqlite3.connect(snapshot / 'review.sqlite3') as dest:
                src.backup(dest)
    (snapshot / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Backup: {backup}\nSource archive: {snapshot}', flush=True)
    with connect(url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('hindidb-import'))")
        if conn.execute('SELECT 1 FROM hindi_dictionary_state WHERE id=1').fetchone():
            raise RuntimeError('Another import already completed.')
        existing = conn.execute("SELECT id,headword,pos FROM lemmas WHERE language='hi' ORDER BY curator_locked DESC,created_at,id").fetchall()
        by_key = {}
        for uid, headword, pos in existing:
            by_key.setdefault((headword, pos), uid)
        conn.execute('CREATE TEMP TABLE hindi_stage (id uuid PRIMARY KEY, external_id text, headword text, pos text, entry jsonb) ON COMMIT DROP')
        ids = {e['id']: by_key.get((e['lemma'], e['pos']), uuid4()) for e in entries}
        group_ids = {e['group_id']: str(uuid4()) for e in entries if e.get('group_id')}
        with conn.cursor().copy('COPY hindi_stage FROM STDIN') as copy:
            for entry in entries:
                if entry.get('group_id'):
                    entry = {**entry, 'group_id': group_ids[entry['group_id']],
                             'group_primary': str(ids[entry['group_primary']]),
                             'group_uses': [{**use, 'id': str(ids[use['id']])} for use in entry['group_uses']]}
                copy.write_row((ids[entry['id']], entry['id'], entry['lemma'], entry['pos'], Jsonb(entry)))
        # Archive user records that cannot be matched, rather than silently losing their meaning.
        unmatched = conn.execute("""SELECT row_to_json(k),l.headword,l.pos FROM user_known_lemmas k JOIN lemmas l ON l.id=k.lemma_id
          WHERE l.language='hi' AND NOT EXISTS(SELECT 1 FROM hindi_stage s WHERE s.headword=l.headword AND s.pos=l.pos)""").fetchall()
        (snapshot/'unmatched-vocabulary.json').write_text(json.dumps(unmatched, ensure_ascii=False, indent=2, default=str)+'\n')
        # Reuse existing UUIDs where lexical identity is exact. No spelling/POS guesses.
        conn.execute("""INSERT INTO lemmas(id,language,headword,pos,script,source,source_id,source_attribution,curator_locked)
          SELECT id,'hi',headword,pos,'Deva','curator','hindidb:'||external_id,'HindiDB',true FROM hindi_stage
          ON CONFLICT(id) DO UPDATE SET source='curator',source_id=EXCLUDED.source_id,
          source_attribution='HindiDB',curator_locked=true,paradigm_id=NULL,stem=NULL,gloss_default=NULL,updated_at=now()""")
        conn.execute("""INSERT INTO user_known_lemmas(user_id,lemma_id,status,updated_at,mined_sentence,mined_chapter_id,mined_token_idx)
          SELECT DISTINCT ON(k.user_id,s.id) k.user_id,s.id,k.status,k.updated_at,k.mined_sentence,k.mined_chapter_id,k.mined_token_idx
          FROM user_known_lemmas k JOIN lemmas l ON l.id=k.lemma_id JOIN hindi_stage s ON s.headword=l.headword AND s.pos=l.pos
          WHERE l.language='hi' ORDER BY k.user_id,s.id,k.updated_at DESC
          ON CONFLICT(user_id,lemma_id) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at""")
        conn.execute("DELETE FROM translations WHERE (target_type='lemma' AND target_id IN(SELECT id FROM lemmas WHERE language='hi')) OR (target_type='phrase' AND target_id IN(SELECT id FROM phrases WHERE language='hi'))")
        conn.execute("DELETE FROM lemma_forms WHERE lemma_id IN(SELECT id FROM lemmas WHERE language='hi')")
        conn.execute("DELETE FROM form_lemma_overrides WHERE language='hi'")
        conn.execute("DELETE FROM phrase_proposals WHERE language='hi'")
        conn.execute("DELETE FROM phrases WHERE language='hi'")
        conn.execute("DELETE FROM lemmas WHERE language='hi' AND id NOT IN(SELECT id FROM hindi_stage)")
        conn.execute('INSERT INTO hindi_entries(lemma_id,external_id,entry) SELECT id,external_id,entry FROM hindi_stage')
        # Reference material can be imported before the dictionary.
        conn.execute("""WITH moved AS (
          DELETE FROM hindi_reference_cache c USING hindi_stage s WHERE c.key='loan:'||s.external_id
          RETURNING s.id,c.result,c.retrieved_at
        ) INSERT INTO hindi_reference_cache(key,result,retrieved_at)
          SELECT 'loan:'||id,result,retrieved_at FROM moved ON CONFLICT (key) DO NOTHING""")
        with conn.cursor().copy('COPY lemma_forms(lemma_id,surface,features,created_by) FROM STDIN') as copy:
            for entry in entries:
                for form in sorted(set(entry.get('forms', []))):
                    copy.write_row((ids[entry['id']], form, Jsonb({}), 'curator'))
        with conn.cursor().copy('COPY translations(target_type,target_id,source,body,target_language,source_id) FROM STDIN') as copy:
            for entry in entries:
                # Match HindiDB's reader: reviewed translation, falling back
                # to English original; join all senses into one editable row.
                meanings = [d.get('translation') or (d.get('original') if d.get('language') == 'en' else '')
                            for d in entry.get('definitions', [])]
                body = '; '.join(value for value in meanings if value).strip()
                if body:
                    copy.write_row(('lemma',ids[entry['id']],'curator',body,'en',f"hindidb:{entry['id']}:meaning:en"))
        conn.execute("""UPDATE lemmas l SET gloss_default=(SELECT body FROM translations t WHERE t.target_type='lemma'
          AND t.target_id=l.id AND t.target_language='en' ORDER BY t.source_id LIMIT 1) WHERE l.language='hi'""")
        metadata = {'fingerprint': fingerprint, 'source_archive': str(snapshot), 'backup': str(backup),
                    'upstream_parser': '0.4.2', 'imported_at': stamp,
                    'history': {k:v for k,v in lexicon.documents[-1].items() if k!='entries'}}
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS lemmas_hindi_identity_idx ON lemmas(headword,pos) WHERE language='hi'")
        conn.execute('INSERT INTO hindi_dictionary_state(id,revision,metadata) VALUES(1,1,%s)',(Jsonb(metadata),))
        # Text bodies, progress, and collections survive; token analyses are rebuilt separately.
    print('HindiDB dictionary imported. Reprocess Hindi chapters before restarting the app.', flush=True)


if __name__ == '__main__':
    main()
