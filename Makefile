.PHONY: up down build logs db-seed db-generate test test-e2e clean

CLAIMS ?= 15

up:
	docker-compose up -d

build:
	docker-compose up -d --build

down:
	docker-compose down

clean:
	docker-compose down -v
	rm -rf dist node_modules

logs:
	docker-compose logs -f

db-seed:
	npx ts-node src/db/seed.ts

db-generate: ## Append test policies, rules and pending claims (never deletes). Usage: make db-generate CLAIMS=20 SEED=7
	npx ts-node src/db/generate.ts --claims $(CLAIMS)$(if $(SEED), --seed $(SEED))

test:
	npm test

test-e2e: ## Builds first: the stdio MCP E2E test spawns dist/mcp/server.js
	npm run build
	npm run test:e2e
