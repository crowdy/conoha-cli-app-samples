package handler

import (
	"encoding/json"
	"net/http"

	"github.com/crowdy/conoha-cli-app-samples/nextjs-go-google_ucp/api/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProductsHandler struct {
	queries *generated.Queries
}

func NewProductsHandler(pool *pgxpool.Pool) *ProductsHandler {
	return &ProductsHandler{queries: generated.New(pool)}
}

func (h *ProductsHandler) List(w http.ResponseWriter, r *http.Request) {
	products, err := h.queries.ListProducts(r.Context())
	if err != nil {
		http.Error(w, `{"error":"failed to list products"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(products)
}

func (h *ProductsHandler) Get(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	parsed, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid product id"}`, http.StatusBadRequest)
		return
	}
	id := pgtype.UUID{Bytes: parsed, Valid: true}
	product, err := h.queries.GetProduct(r.Context(), id)
	if err != nil {
		http.Error(w, `{"error":"product not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(product)
}
