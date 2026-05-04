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
 && pip install -e '.[dev,models]' \
 && apt-get purge -y --auto-remove gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*

COPY services/nlp/app /srv/nlp/app
COPY services/nlp/tests /srv/nlp/tests
COPY packages/shared-types/python /opt/shared-types

ENV PYTHONPATH=/opt/shared-types:/srv/nlp

# Pre-download the Stanza models at image-build time so the first
# /process request doesn't pay a multi-hundred-megabyte download and
# so production stays offline-safe (each build_*_pipeline constructs
# stanza.Pipeline with download_method=None). Odia (T-2.3a) is a
# custom IndicNLP-based pipeline and doesn't need a Stanza download.
RUN python -c "import stanza; [stanza.download(lang, processors='tokenize,pos,lemma', verbose=False) for lang in ('hi', 'mr')]"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
