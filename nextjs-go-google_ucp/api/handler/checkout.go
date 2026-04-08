package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/crowdy/conoha-cli-app-samples/nextjs-go-google_ucp/api/generated"
	"github.com/crowdy/conoha-cli-app-samples/nextjs-go-google_ucp/api/ucp"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CheckoutHandler struct {
	queries *generated.Queries
}

func NewCheckoutHandler(pool *pgxpool.Pool) *CheckoutHandler {
	return &CheckoutHandler{queries: generated.New(pool)}
}

// --- helper: convert between pgtype.UUID and uuid.UUID ---

func pgtypeUUID(u uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: u, Valid: true}
}

func uuidFromPgtype(p pgtype.UUID) uuid.UUID {
	return uuid.UUID(p.Bytes)
}

func pgtypeText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

func textFromPgtype(p pgtype.Text) string {
	if !p.Valid {
		return ""
	}
	return p.String
}

// --- request / response types ---

type lineItemReq struct {
	ProductID string `json:"product_id"`
	Quantity  int32  `json:"quantity"`
}

type createCheckoutReq struct {
	Currency              string        `json:"currency"`
	BuyerEmail            string        `json:"buyer_email"`
	LineItems             []lineItemReq `json:"line_items"`
	RequestedCapabilities []string      `json:"requested_capabilities"`
}

type updateCheckoutReq struct {
	DiscountCode string `json:"discount_code"`
}

type completeCheckoutReq struct {
	Payment struct {
		HandlerID string `json:"handler_id"`
		Token     string `json:"token"`
	} `json:"payment"`
}

type checkoutItemResp struct {
	ID          uuid.UUID `json:"id"`
	SessionID   uuid.UUID `json:"session_id"`
	ProductID   uuid.UUID `json:"product_id"`
	Quantity    int32     `json:"quantity"`
	PriceCents  int32     `json:"price_cents"`
	ProductName string    `json:"product_name"`
}

type checkoutSessionResp struct {
	ID             uuid.UUID          `json:"id"`
	Status         string             `json:"status"`
	Currency       string             `json:"currency"`
	SubtotalCents  int32              `json:"subtotal_cents"`
	DiscountCents  int32              `json:"discount_cents"`
	TotalCents     int32              `json:"total_cents"`
	BuyerEmail     string             `json:"buyer_email,omitempty"`
	PaymentHandler string             `json:"payment_handler,omitempty"`
	PaymentToken   string             `json:"payment_token,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
	Items          []checkoutItemResp `json:"items,omitempty"`
	Capabilities   []ucp.Capability   `json:"capabilities,omitempty"`
}

func sessionToResp(s generated.CheckoutSession) checkoutSessionResp {
	return checkoutSessionResp{
		ID:             uuidFromPgtype(s.ID),
		Status:         s.Status,
		Currency:       s.Currency,
		SubtotalCents:  s.SubtotalCents,
		DiscountCents:  s.DiscountCents,
		TotalCents:     s.TotalCents,
		BuyerEmail:     textFromPgtype(s.BuyerEmail),
		PaymentHandler: textFromPgtype(s.PaymentHandler),
		PaymentToken:   textFromPgtype(s.PaymentToken),
		CreatedAt:      s.CreatedAt.Time,
		UpdatedAt:      s.UpdatedAt.Time,
	}
}

func itemRowToResp(r generated.ListCheckoutItemsRow) checkoutItemResp {
	return checkoutItemResp{
		ID:          uuidFromPgtype(r.ID),
		SessionID:   uuidFromPgtype(r.SessionID),
		ProductID:   uuidFromPgtype(r.ProductID),
		Quantity:    r.Quantity,
		PriceCents:  r.PriceCents,
		ProductName: r.ProductName,
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// --- handlers ---

func (h *CheckoutHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createCheckoutReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Currency == "" {
		req.Currency = "USD"
	}

	ctx := r.Context()

	// Create the session
	session, err := h.queries.CreateCheckoutSession(ctx, generated.CreateCheckoutSessionParams{
		Currency:   req.Currency,
		BuyerEmail: pgtypeText(req.BuyerEmail),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	// Add line items and calculate subtotal
	var subtotal int32
	for _, li := range req.LineItems {
		pid, err := uuid.Parse(li.ProductID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid product_id: "+li.ProductID)
			return
		}
		product, err := h.queries.GetProduct(ctx, pgtypeUUID(pid))
		if err != nil {
			writeError(w, http.StatusBadRequest, "product not found: "+li.ProductID)
			return
		}
		lineCents := product.PriceCents * li.Quantity
		_, err = h.queries.CreateCheckoutItem(ctx, generated.CreateCheckoutItemParams{
			SessionID:  session.ID,
			ProductID:  pgtypeUUID(pid),
			Quantity:   li.Quantity,
			PriceCents: product.PriceCents,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create line item")
			return
		}
		subtotal += lineCents
	}

	// Update session with subtotal
	session, err = h.queries.UpdateCheckoutSession(ctx, generated.UpdateCheckoutSessionParams{
		ID:             session.ID,
		Status:         session.Status,
		SubtotalCents:  subtotal,
		DiscountCents:  0,
		TotalCents:     subtotal,
		PaymentHandler: session.PaymentHandler,
		PaymentToken:   session.PaymentToken,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update session totals")
		return
	}

	// Capability negotiation
	caps := ucp.Negotiate(req.RequestedCapabilities)

	// Fetch items for response
	items, err := h.queries.ListCheckoutItems(ctx, session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list items")
		return
	}

	resp := sessionToResp(session)
	resp.Capabilities = caps
	for _, item := range items {
		resp.Items = append(resp.Items, itemRowToResp(item))
	}

	writeJSON(w, http.StatusCreated, resp)
}

func (h *CheckoutHandler) Get(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	parsed, err := uuid.Parse(idStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}

	ctx := r.Context()
	session, err := h.queries.GetCheckoutSession(ctx, pgtypeUUID(parsed))
	if err != nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	items, err := h.queries.ListCheckoutItems(ctx, session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list items")
		return
	}

	resp := sessionToResp(session)
	for _, item := range items {
		resp.Items = append(resp.Items, itemRowToResp(item))
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *CheckoutHandler) Update(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	parsed, err := uuid.Parse(idStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}

	var req updateCheckoutReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx := r.Context()
	session, err := h.queries.GetCheckoutSession(ctx, pgtypeUUID(parsed))
	if err != nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	// Apply discount: any non-empty code gives 10% off
	discountCents := int32(0)
	if req.DiscountCode != "" {
		discountCents = session.SubtotalCents / 10
	}
	totalCents := session.SubtotalCents - discountCents

	session, err = h.queries.UpdateCheckoutSession(ctx, generated.UpdateCheckoutSessionParams{
		ID:             session.ID,
		Status:         session.Status,
		SubtotalCents:  session.SubtotalCents,
		DiscountCents:  discountCents,
		TotalCents:     totalCents,
		PaymentHandler: session.PaymentHandler,
		PaymentToken:   session.PaymentToken,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update session")
		return
	}

	items, err := h.queries.ListCheckoutItems(ctx, session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list items")
		return
	}

	resp := sessionToResp(session)
	for _, item := range items {
		resp.Items = append(resp.Items, itemRowToResp(item))
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *CheckoutHandler) Complete(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	parsed, err := uuid.Parse(idStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}

	var req completeCheckoutReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Mock payment: token "fail" returns error
	if req.Payment.Token == "fail" {
		writeError(w, http.StatusPaymentRequired, "payment failed")
		return
	}

	ctx := r.Context()
	session, err := h.queries.GetCheckoutSession(ctx, pgtypeUUID(parsed))
	if err != nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	session, err = h.queries.UpdateCheckoutSession(ctx, generated.UpdateCheckoutSessionParams{
		ID:             session.ID,
		Status:         "complete",
		SubtotalCents:  session.SubtotalCents,
		DiscountCents:  session.DiscountCents,
		TotalCents:     session.TotalCents,
		PaymentHandler: pgtypeText(req.Payment.HandlerID),
		PaymentToken:   pgtypeText(req.Payment.Token),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to complete session")
		return
	}

	items, err := h.queries.ListCheckoutItems(ctx, session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list items")
		return
	}

	resp := sessionToResp(session)
	for _, item := range items {
		resp.Items = append(resp.Items, itemRowToResp(item))
	}

	writeJSON(w, http.StatusOK, resp)
}
