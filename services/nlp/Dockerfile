FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/nlp

# unicodedata2 (transitive via indic-nlp-library) has no prebuilt wheel
# for aarch64-linux, so pip compiles it from C source. The slim base
# image doesn't ship a compiler — install gcc + headers, do the install,
# then purge in the same RUN so the final layer doesn't carry them.
COPY services/nlp/pyproject.toml /srv/nlp/pyproject.toml
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && pip install -U pip \
 && pip install --index-url https://download.pytorch.org/whl/cpu 'torch==2.15.0+cpu' \
 && pip install -e '.[dev,models,ocr]' \
 && apt-get purge -y --auto-remove gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*

# Stanza keeps its own copy of each model for offline use.
RUN --mount=type=cache,target=/root/.cache/huggingface \
    python -c "import stanza; [stanza.download(lang, processors='tokenize,pos,lemma', verbose=False) for lang in ('mr', 'eu')]"

COPY services/nlp/parhiba_hindi /srv/nlp/parhiba_hindi
COPY services/nlp/app /srv/nlp/app
COPY services/nlp/hindidb /srv/nlp/hindidb
COPY services/nlp/tests /srv/nlp/tests
COPY packages/shared-types/python /opt/shared-types

ENV PYTHONPATH=/opt/shared-types:/srv/nlp

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
