.PHONY: dev dev-down install install-nlp lint typecheck test smoke clean

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

smoke:
	@echo "Hitting web smoke endpoint..."
	curl -sS http://localhost:5173/api/v1/smoke | tee /dev/stderr | python3 -m json.tool

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules \
	       apps/*/.svelte-kit apps/*/build \
	       services/nlp/.venv services/nlp/.pytest_cache services/nlp/.ruff_cache
