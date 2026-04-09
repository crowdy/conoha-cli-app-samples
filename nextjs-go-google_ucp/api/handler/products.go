package handler

import (
	"encoding/json"
	"net/http"

	"github.com/crowdy/conoha-cli-app-samples/nextjs-go-google_ucp/api/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type productResp struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	PriceCents  int32     `json:"price_cents"`
	Currency    string    `json:"currency"`
	ImageUrl    string    `json:"image_url"`
	InStock     bool      `json:"in_stock"`
}

func productToResp(p generated.Product) productResp {
	desc := ""
	if p.Description.Valid {
		desc = p.Description.String
	}
	imgUrl := ""
	if p.ImageUrl.Valid {
		imgUrl = p.ImageUrl.String
	}
	return productResp{
		ID:          uuidFromPgtype(p.ID),
		Name:        p.Name,
		Description: desc,
		PriceCents:  p.PriceCents,
		Currency:    p.Currency,
		ImageUrl:    imgUrl,
		InStock:     p.InStock,
	}
}

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
	resp := make([]productResp, len(products))
	for i, p := range products {
		resp[i] = productToResp(p)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
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
	json.NewEncoder(w).Encode(productToResp(product))
}
