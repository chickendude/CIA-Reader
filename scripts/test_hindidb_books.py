"""Import invariants; source books are never required by these fixtures."""

import unittest
from import_hindidb_books import NUMBERS, choice_status, partition, source_chapters


class ImportTests(unittest.TestCase):
    def test_partition_preserves_source_and_does_not_split_overlapping_spans(self):
        text = "🙂 किताब\n" * 30
        spans = [(10, 35), (34, 48), (60, 75)]
        chunks = list(partition(text, spans, target=20))
        self.assertEqual("".join(body for _, _, body in chunks), text)
        self.assertGreater(len(chunks), 1)
        for start, end, body in chunks:
            self.assertEqual(text[start:end], body)
            self.assertFalse(any(a < end < b for a, b in spans))

    def test_chapters_follow_numbered_headings_and_preserve_every_character(self):
        prefix = "समर्पण\n\n📖\n"
        for book, count in [("Harry Potter 1", 17), ("Harry Potter 2", 18)]:
            numbers = NUMBERS[:count]
            if count == 17:
                numbers[14] = "पंद्र्रह"
            sections = [
                f"अध्याय - {n}\n\nशीर्षक {n}\n\nयह अध्याय - दो है।\n\n" for n in numbers
            ]
            text = prefix + "".join(sections)
            chapters = source_chapters(book, text)
            self.assertEqual(
                [ch.title for ch in chapters], [f"शीर्षक {n}" for n in numbers]
            )
            self.assertEqual(
                [text[ch.start : ch.end] for ch in chapters],
                [prefix + sections[0], *sections[1:]],
            )
            self.assertEqual("".join(text[ch.start : ch.end] for ch in chapters), text)

    def test_incomplete_or_repeated_headings_cannot_be_imported(self):
        text = "".join(f"अध्याय - {n}\nशीर्षक\n" for n in NUMBERS)
        for damaged in [
            text.replace("अध्याय - चार", "चार"),
            text.replace("अध्याय - चार", "अध्याय - तीन"),
        ]:
            with self.assertRaises(ValueError):
                source_chapters("Harry Potter 2", damaged)

    def test_choices_survive_meaning_edits_but_not_identity_or_context_changes(self):
        identities = {
            "noun": ("uuid-noun", "खाना", "NOUN"),
            "verb": ("uuid-verb", "खाना", "VERB"),
        }
        choice = {
            "candidate_snapshot": [
                dict(
                    id=key,
                    lemma=value[1],
                    pos=value[2],
                    definitions=[{"translation": "old"}],
                )
                for key, value in identities.items()
            ],
            "selected_entries": ["verb"],
            "start": 3,
            "end": 7,
            "surface": "खाना",
            "current_surface": "खाना",
            "sentence_text": "खाना है।",
            "current_sentence": "खाना है।",
            "origin": "ai",
            "outcome": "selected",
        }
        supported = {"uuid-noun", "uuid-verb"}
        self.assertEqual(
            choice_status(choice, "खाना", 3, supported, identities),
            (["uuid-verb"], ["uuid-noun", "uuid-verb"], "ai_suggested"),
        )
        self.assertEqual(
            choice_status(
                {**choice, "origin": "human"}, "खाना", 3, supported, identities
            )[2],
            "confirmed",
        )
        for change in ({"current_sentence": "खाना था।"}, {"current_surface": "खाने"}):
            self.assertEqual(
                choice_status({**choice, **change}, "खाना", 3, supported, identities)[
                    2
                ],
                "needs_review",
            )
        self.assertEqual(
            choice_status(choice, "खाना", 3, {"uuid-verb"}, identities)[2],
            "needs_review",
        )
        self.assertEqual(
            choice_status(choice, "खाना", 3, supported, {"verb": identities["verb"]})[
                2
            ],
            "needs_review",
        )


if __name__ == "__main__":
    unittest.main()
