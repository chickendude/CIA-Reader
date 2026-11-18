"""Candidate-based coverage and a shared frequency-first study plan."""


def coverage(analysis, states):
    rows = analysis["frequencies"]
    counts = {s: sum(r["count"] for r in rows if states.get(r["entry_id"], "unseen") == s)
              for s in ["known", "learning", "unseen"]}
    unknown = analysis["stats"]["unresolved_occurrences"]
    denominator = sum(counts.values()) + unknown
    unique_ids = {r.get('group_primary', r['entry_id']) for r in rows}
    unique = len(unique_ids)
    return {
        "metric": "candidate-occurrence coverage including unresolved gaps",
        "denominator": denominator, "known_occurrences": counts["known"],
        "learning_occurrences": counts["learning"], "unseen_occurrences": counts["unseen"],
        "unresolved_occurrences": unknown,
        "known_fraction": counts["known"] / denominator if denominator else None,
        "studied_fraction": (counts["known"] + counts["learning"]) / denominator if denominator else None,
        "parser_ceiling": sum(counts.values()) / denominator if denominator else None,
        "unique_resolved_entries": unique,
        "unique_known_fraction": sum(states.get(key) == 'known' for key in unique_ids) / unique if unique else None,
        "unique_metric_scope": "resolved entries, counting explicitly grouped POS uses as one word; unresolved counts are reported separately",
        "excluded": analysis["stats"]["excluded"],
        "input_warning": analysis["stats"].get("input_warning"),
    }


def plan(books, states, target=0.98, *, ignore_proper_nouns=False, ignore_english_loans=False, english_loan_ids=()):
    if not isinstance(ignore_proper_nouns, bool):
        raise ValueError('Ignore proper nouns must be true or false')
    if not isinstance(ignore_english_loans, bool):
        raise ValueError('Ignore English loans must be true or false')
    loan_ids = set(english_loan_ids)
    def excluded(row):
        return ((ignore_proper_nouns and row['pos'] == 'PROPN')
                or (ignore_english_loans and row['entry_id'] in loan_ids))
    if not 0 < target <= 1:
        raise ValueError("Target must be greater than 0 and at most 1")
    if not books:
        raise ValueError("Import at least one book before planning")
    # The same book requested twice must not distort the corpus frequencies.
    books = list({b["id"]: b for b in books}.values())
    summaries, merged = {}, {}
    for book in books:
        analysis = book['analysis']
        rows = [row for row in analysis['frequencies'] if not excluded(row)]
        cov = coverage({**analysis, 'frequencies': rows}, states)
        summaries[book["id"]] = {"id": book["id"], "title": book["title"], **cov,
                                 'ignored_proper_noun_occurrences': sum(row['count'] for row in analysis['frequencies'] if ignore_proper_nouns and row['pos'] == 'PROPN'),
                                 'ignored_english_loan_occurrences': sum(row['count'] for row in analysis['frequencies'] if ignore_english_loans and row['entry_id'] in loan_ids),
                                 "projected_occurrences": cov["known_occurrences"] + cov["learning_occurrences"]}
        for row in rows:
            if (ignore_proper_nouns or ignore_english_loans) and row.get('group_uses'):
                row = {**row, 'group_uses': [use for use in row['group_uses'] if not excluded({**use, 'entry_id': use['id']})]}
            key = row.get('group_primary', row['entry_id'])
            combined = merged.setdefault(key, {**row, 'entry_id': key, "count": 0, "books": {}, 'forms': {}, 'definitions': []})
            if ignore_proper_nouns or ignore_english_loans:
                # A group's stable export ID may belong to an ignored name.
                # Examples must come only from the retained lexical uses.
                ids = combined.setdefault('example_entry_ids', [])
                for entry_id in row.get('example_entry_ids', [row['entry_id']]):
                    if entry_id not in ids:
                        ids.append(entry_id)
            elif row.get('example_entry_ids'):
                ids = combined.setdefault('example_entry_ids', [])
                for entry_id in row['example_entry_ids']:
                    if entry_id not in ids:
                        ids.append(entry_id)
            if row.get('group_uses'):
                uses = {use['id']: use for use in combined.get('group_uses', [])}
                uses.update({use['id']: use for use in row['group_uses']})
                combined['group_uses'] = list(uses.values())
                combined['pos'] = ' / '.join(dict.fromkeys(use['pos'] for use in uses.values()))
            for definition in row.get('definitions', []):
                if definition not in combined['definitions']:
                    combined['definitions'].append(definition)
            for form, count in row.get('forms', {}).items():
                combined['forms'][form] = combined['forms'].get(form, 0) + count
            combined["count"] += row["count"]
            combined["books"][book["id"]] = combined['books'].get(book['id'], 0) + row["count"]
    ranked = sorted(merged.values(), key=lambda r: (-r["count"], r["lemma"], r["pos"]))
    selected = []
    for row in ranked:
        if states.get(row["entry_id"], "unseen") != "unseen":
            continue
        useful = any(summaries[b]["projected_occurrences"] + 1e-12 < target * summaries[b]["denominator"] for b in row["books"])
        if not useful:
            continue
        selected.append(row)
        for book_id, count in row["books"].items():
            summaries[book_id]["projected_occurrences"] += count
    for summary in summaries.values():
        denominator = summary["denominator"]
        summary["projected_fraction"] = summary.pop("projected_occurrences") / denominator if denominator else None
        summary["target_reachable"] = denominator > 0 and not summary["input_warning"] and summary["parser_ceiling"] + 1e-12 >= target
        summary["target_met_now"] = denominator > 0 and not summary["input_warning"] and summary["known_fraction"] + 1e-12 >= target
    return {
        'ignore_proper_nouns': ignore_proper_nouns,
        'ignore_english_loans': ignore_english_loans,
        'coverage_scope': 'excluding ' + ' and '.join(label for enabled, label in [(ignore_proper_nouns, 'proper nouns'), (ignore_english_loans, 'English loans')] if enabled)
                          if ignore_proper_nouns or ignore_english_loans else 'all word types',
        "target": target, "target_scope": "each selected book",
        "ordering": "combined corpus frequency, skipping words only needed in books already at target",
        "projection_assumption": "all learning words and all selected new words become known",
        "metric_caveat": "candidate counts include valid alternatives and compounds; this is not a comprehension percentage",
        "new_words": selected, "new_word_count": len(selected),
        "learning_words_to_finish": sum(states.get(k) == "learning" for k in merged),
        "books": list(summaries.values()),
    }
