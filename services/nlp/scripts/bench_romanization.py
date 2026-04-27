"""Eyeball romanization output on a paragraph per language.

Tests cover correctness on individual words; this script is for visually
sanity-checking real prose when tweaking the romanizer (e.g. adding a new
post-processor rule). Run from services/nlp/:

    python -m venv .venv && source .venv/bin/activate
    pip install -e '.[dev]'
    PYTHONPATH=../../packages/shared-types/python python scripts/bench_romanization.py
"""

from __future__ import annotations

import time

from app.romanization import romanize

SAMPLES = {
    "hi": (
        "राम एक छोटे से गाँव में रहता था। उसका घर नदी के किनारे था और "
        "वह हर सुबह पुस्तक पढ़ने के लिए स्कूल जाता था। उसके पिता एक "
        "किसान थे और माँ कमला घर का काम करती थीं। भारत के इस गाँव में "
        "धर्म और कर्म दोनों का बहुत महत्व था।"
    ),
    "mr": (
        "राम एका छोट्या गावात राहत होता. त्याचे घर नदीच्या काठावर होते "
        "आणि तो दररोज सकाळी पुस्तक वाचण्यासाठी शाळेत जात असे. त्याचे "
        "वडील शेतकरी होते आणि आई कमला घरकाम करायची. महाराष्ट्रातील "
        "या गावात मराठी संस्कृती जपली जात होती."
    ),
    "or": (
        "ରାମ ଗୋଟିଏ ଛୋଟ ଗାଁରେ ରହୁଥିଲେ। ତାଙ୍କ ଘର ନଦୀ କୂଳରେ ଥିଲା ଏବଂ "
        "ସେ ପ୍ରତିଦିନ ସକାଳେ ବହି ପଢ଼ିବାକୁ ବିଦ୍ୟାଳୟ ଯାଉଥିଲେ। ତାଙ୍କ ବାପା "
        "ଜଣେ କୃଷକ ଥିଲେ ଏବଂ ମା ଘର କାମ କରୁଥିଲେ। ଏହି ଗାଁରେ ଓଡ଼ିଆ "
        "ସଂସ୍କୃତି ଏବେ ବି ବଞ୍ଚିଛି।"
    ),
}


def main() -> None:
    for lang, text in SAMPLES.items():
        start = time.perf_counter()
        out = romanize(lang, text)
        elapsed_ms = (time.perf_counter() - start) * 1000
        bar = "=" * 78
        print(f"\n{bar}\n  {lang}  —  {elapsed_ms:.1f} ms\n{bar}")
        print(text)
        print()
        print(out)


if __name__ == "__main__":
    main()
