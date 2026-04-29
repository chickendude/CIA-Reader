.PHONY: dev dev-down install install-nlp lint typecheck test test-coverage smoke clean dev-native dev-native-services dev-native-down dev-native-db dev-native-nlp dev-native-web

dev:
	docker compose -f infra/docker-compose.yml up --build

dev-down:
	docker compose -f infra/docker-compose.yml down

install:
	pnpm install
	$(MAKE) install-nlp

install-nlp:
	cd services/nlp && python3 -m venv .venv && .venv/bin/pip install -U pip && .venv/bin/pip install -e '.[dev]'

lint:
	pnpm -r --parallel lint
	cd services/nlp && .venv/bin/ruff check .

typecheck:
	pnpm -r --parallel typecheck

test:
	pnpm -r --parallel test
	cd services/nlp && .venv/bin/pytest

test-coverage:
	pnpm -r --parallel test:coverage
	cd services/nlp && .venv/bin/pytest

smoke:
	@echo "Hitting web smoke endpoint..."
	curl -sS http://localhost:5173/api/v1/smoke | tee /dev/stderr | python3 -m json.tool

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules \
	       apps/*/.svelte-kit apps/*/build \
	       services/nlp/.venv services/nlp/.pytest_cache services/nlp/.ruff_cache

# Native dev: data services in docker, web + nlp on the host. Use when
# docker buildx can't reach pypi/npm registries (corp DNS, VPN, etc.).
NATIVE_ENV = \
	NLP_SERVICE_URL=http://localhost:8000 \
	DATABASE_URL=postgres://ciareader:ciareader@localhost:5432/ciareader \
	REDIS_URL=redis://localhost:6379 \
	AUTH_SECRET=dev-only-secret-replace-in-prod-0000000000000000000000000000000 \
	APP_BASE_URL=http://localhost:5173 \
	SMTP_HOST=localhost \
	SMTP_PORT=1025 \
	SMTP_FROM=no-reply@ciareader.local

dev-native: dev-native-services dev-native-db
	@echo ""
	@echo "Data services up + DB schema applied. Now in two terminals:"
	@echo "  make dev-native-nlp   # FastAPI on :8000"
	@echo "  make dev-native-web   # SvelteKit on :5173"
	@echo ""
	@echo "Web:     http://localhost:5173"
	@echo "Mailpit: http://localhost:8025"

dev-native-services:
	docker compose -f infra/docker-compose.yml up -d postgres redis mailpit

dev-native-down:
	docker compose -f infra/docker-compose.yml stop postgres redis mailpit

dev-native-db:
	cd apps/web && $(NATIVE_ENV) pnpm exec drizzle-kit push --verbose

dev-native-nlp:
	cd services/nlp && PYTHONPATH=../../packages/shared-types/python:. .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

dev-native-web:
	cd apps/web && $(NATIVE_ENV) pnpm dev
