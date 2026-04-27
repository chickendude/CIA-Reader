FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/nlp

COPY services/nlp/pyproject.toml /srv/nlp/pyproject.toml
RUN pip install -U pip && pip install -e '.[dev,models]'

COPY services/nlp/app /srv/nlp/app
COPY services/nlp/tests /srv/nlp/tests
COPY packages/shared-types/python /opt/shared-types

ENV PYTHONPATH=/opt/shared-types:/srv/nlp

# Pre-download the Stanza Hindi model at image-build time so the first
# /process request doesn't pay a multi-hundred-megabyte download and so
# production stays offline-safe (the pipeline is constructed with
# download_method=None). Future languages (mr, or) will be added here
# as their pipelines ship.
RUN python -c "import stanza; stanza.download('hi', processors='tokenize,pos,lemma', verbose=False)"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
