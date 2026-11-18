"""Explicit word records containing independently parsed POS uses."""

GROUP_FIELDS = ('group_id', 'group_primary', 'group_uses')


def apply_groups(lexicon):
    groups = {}
    for document in lexicon.documents:
        for group in document.get('entry_groups', []):
            groups[group['id']] = group
    # Remove previously derived metadata without mutating a shared lexicon.
    for key, entry in list(lexicon.entries.items()):
        if any(field in entry for field in GROUP_FIELDS):
            lexicon.entries[key] = {k: v for k, v in entry.items() if k not in GROUP_FIELDS}
    assigned = set()
    for group in groups.values():
        members = [key for key in group['members'] if key in lexicon.entries]
        if len(members) < 2:
            continue
        if len(set(members)) != len(members) or assigned.intersection(members):
            raise ValueError('A POS use can belong to only one word group')
        if any(lexicon.entries[key]['lemma'] != group['lemma'] for key in members):
            raise ValueError('Grouped POS uses must share the same dictionary form')
        assigned.update(members)
        uses = [{'id': key, 'pos': lexicon.entries[key]['pos']} for key in members]
        primary = group.get('primary') if group.get('primary') in members else members[0]
        for key in members:
            lexicon.entries[key] = {**lexicon.entries[key], 'group_id': group['id'],
                                    'group_primary': primary, 'group_uses': uses}
