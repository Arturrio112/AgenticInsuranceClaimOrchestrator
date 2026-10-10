.PHONY: up down build logs db-seed test test-e2e clean

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

test:
	npm test

test-e2e: ## Builds first: the stdio MCP E2E test spawns dist/mcp/server.js
	npm run build
	npm run test:e2e
