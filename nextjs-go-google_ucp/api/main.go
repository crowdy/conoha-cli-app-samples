package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/crowdy/conoha-cli-app-samples/nextjs-go-google_ucp/api/handler"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer pool.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handler.Health)

	productsHandler := handler.NewProductsHandler(pool)
	mux.HandleFunc("GET /products", productsHandler.List)
	mux.HandleFunc("GET /products/{id}", productsHandler.Get)
	mux.HandleFunc("GET /ucp/manifest", handler.Manifest)

	checkoutHandler := handler.NewCheckoutHandler(pool)
	mux.HandleFunc("POST /checkout-sessions", checkoutHandler.Create)
	mux.HandleFunc("GET /checkout-sessions/{id}", checkoutHandler.Get)
	mux.HandleFunc("PUT /checkout-sessions/{id}", checkoutHandler.Update)
	mux.HandleFunc("POST /checkout-sessions/{id}/complete", checkoutHandler.Complete)

	log.Println("API server starting on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal(err)
	}
}
