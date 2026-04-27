from __future__ import annotations

import pytest

from app.romanization import romanize


class TestHindi:
    def test_strips_final_schwa(self):
        assert romanize("hi", "राम") == "rām"
        assert romanize("hi", "कमल") == "kamal"
        assert romanize("hi", "घर") == "ghar"

    def test_strips_medial_schwa_when_appropriate(self):
        # लड़का: medial schwa between ḍ-k is dropped in Hindi
        assert romanize("hi", "लड़का") == "laṛkā"
        # भारत: final schwa dropped, medial 'a' kept
        assert romanize("hi", "भारत") == "bhārat"

    def test_preserves_long_a_after_schwa_deletion(self):
        # कमला (proper noun) keeps the long ā even though the medial schwa goes
        assert romanize("hi", "कमला") == "kamlā"

    def test_folds_e_macron_to_plain_e(self):
        # ISO would emit ē/ō; Hindi has no length distinction so we fold
        result = romanize("hi", "नदी के किनारे")
        assert "ē" not in result
        assert result == "nadī ke kināre"

    def test_folds_o_macron_to_plain_o(self):
        result = romanize("hi", "दोनों")
        assert "ō" not in result
        assert result == "donoṁ"


class TestMarathi:
    def test_keeps_inherent_schwa(self):
        # Marathi retains the final schwa: राम → rāma, not rām
        assert romanize("mr", "राम") == "rāma"
        assert romanize("mr", "घर") == "ghara"

    def test_keeps_e_and_o_macrons(self):
        # Marathi distinguishes vowel length, so macrons must survive
        result = romanize("mr", "ते")
        assert "ē" in result


class TestOdia:
    def test_basic_romanization(self):
        assert romanize("or", "ରାମ") == "rāma"

    def test_handles_native_word(self):
        assert romanize("or", "ଓଡ଼ିଆ") == "ōṛiā"


class TestErrorHandling:
    def test_rejects_unsupported_language(self):
        with pytest.raises(ValueError, match="Unsupported language"):
            romanize("ja", "こんにちは")

    def test_empty_string_passes_through(self):
        assert romanize("hi", "") == ""
