.PHONY: up down logs build-worker test-worker test-control-plane load-test

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
