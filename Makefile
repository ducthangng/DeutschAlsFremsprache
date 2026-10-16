.PHONY: db db-down sqlc dev-backend dev-frontend test build run docker

TEST_DATABASE_URL ?= postgres://dfs:dfs@localhost:5432/deutschfremsprache?sslmode=disable

db:                     ## start Postgres (docker compose)
	docker compose up -d --wait postgres

db-down:
	docker compose down

sqlc:                   ## regenerate internal/db/gen from migrations + queries
	cd backend && sqlc generate

dev-backend: db         ## API on :8080
	cd backend && go run ./cmd/server

dev-frontend:           ## Vite on :5173, proxies /api to :8080
	cd frontend && npm run dev

test: db
	cd backend && TEST_DATABASE_URL='$(TEST_DATABASE_URL)' go test ./...

build:
	cd frontend && npm ci && npm run build
	cd backend && go build -o bin/server ./cmd/server

run: db build           ## single binary serving API + frontend on :8080
	cd backend && ./bin/server

docker:                 ## build and run the backend API + Postgres in Docker (uses backend/.env)
	docker compose --profile app up --build
