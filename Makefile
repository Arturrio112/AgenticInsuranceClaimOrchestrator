.PHONY: up down db-seed test test-e2e

up:
	docker-compose up -d

down:
	docker-compose down

db-seed:
	npx ts-node src/db/seed.ts

test:
	npm test

test-e2e:
	npm run test:e2e
