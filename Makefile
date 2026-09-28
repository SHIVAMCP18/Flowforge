.PHONY: up up-scaled down logs dashboard test test-worker test-control-plane test-control-plane-it load-test

up:
	docker compose up --build

up-scaled:
	docker compose up --build --scale worker=5

down:
	docker compose down -v

logs:
	docker compose logs -f

test-control-plane:
	cd control-plane && mvn test

test-worker:
	cd worker && go test ./...

load-test:
	cd load-test && go run . -url=http://localhost:8080 -runs=200 -concurrency=50

# Run the dashboard against a local control plane (Vite proxies /api to :8080).
dashboard:
	cd dashboard && npm install && npm run dev

# Scheduler integration tests against a real, disposable Postgres database.
test-control-plane-it:
	cd control-plane && FLOWFORGE_TEST_DB_URL=$${FLOWFORGE_TEST_DB_URL:-jdbc:postgresql://localhost:5432/flowforge_test} mvn test

test: test-control-plane test-worker
	cd dashboard && npm install && npm run lint && npm run build
