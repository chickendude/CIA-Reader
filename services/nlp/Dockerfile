FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/nlp

COPY services/nlp/pyproject.toml /srv/nlp/pyproject.toml
RUN pip install -e '.[dev,ocr]'

COPY services/nlp/parhiba_hindi /srv/nlp/parhiba_hindi
COPY services/nlp/app /srv/nlp/app
COPY services/nlp/hindidb /srv/nlp/hindidb
COPY services/nlp/parhiba_dictionary /srv/nlp/parhiba_dictionary
COPY services/nlp/tests /srv/nlp/tests
COPY packages/shared-types/python /opt/shared-types

ENV PYTHONPATH=/opt/shared-types:/srv/nlp

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
