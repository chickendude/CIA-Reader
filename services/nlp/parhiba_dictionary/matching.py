"""Find all matching prefixes, including compounds and their components."""


def matching_prefixes(trie, spellings, alternatives=None):
    """Yield the end index, dictionary leaf, and inferred path for each matching spelling."""
    states = [(trie, (), False)]
    for end, observed in spellings:
        variants = (observed, *alternatives(observed)) if alternatives else (observed,)
        following = []
        for node, path, changed in states:
            for spelling in variants:
                child = node.get(spelling)
                if child is None:
                    continue
                next_path = (*path, spelling)
                inferred = changed or spelling != observed
                following.append((child, next_path, inferred))
                if None in child:
                    yield end, child[None], next_path if inferred else ()
        if not following:
            break
        states = following
