.PHONY: dev build run migrate-up test clean

dev: ## Run web and api concurrently
	@trap 'kill 0' INT; \
	(cd web && npm run dev) & \
	(cd api && go run ./cmd/server) & \
	wait

build: ## Build single binary at dist/dashboard
	cd web && npm run build
	# Preserve .placeholder (tracked by git so embed/ is never empty) while replacing built artifacts.
	find api/internal/webfs/embed -mindepth 1 -not -name .placeholder -delete
	cp -r web/out/. api/internal/webfs/embed/
	cd api && go build -o ../dist/dashboard ./cmd/server

run: build
	./dist/dashboard

migrate-up:
	cd api && go run github.com/pressly/goose/v3/cmd/goose@latest -dir migrations sqlite3 ../data/dashboard.db up

test:
	cd api && go test ./...
	cd web && npm test -- --run

clean:
	rm -rf dist web/out web/.next
	find api/internal/webfs/embed -mindepth 1 -not -name .placeholder -delete 2>/dev/null || true
