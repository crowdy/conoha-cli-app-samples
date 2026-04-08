-- name: CreateCheckoutSession :one
INSERT INTO checkout_sessions (status, currency, buyer_email)
VALUES ('incomplete', $1, $2)
RETURNING *;

-- name: GetCheckoutSession :one
SELECT * FROM checkout_sessions WHERE id = $1;

-- name: UpdateCheckoutSession :one
UPDATE checkout_sessions
SET status = $2, subtotal_cents = $3, discount_cents = $4, total_cents = $5,
    payment_handler = $6, payment_token = $7, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateCheckoutItem :one
INSERT INTO checkout_items (session_id, product_id, quantity, price_cents)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListCheckoutItems :many
SELECT ci.id, ci.session_id, ci.product_id, ci.quantity, ci.price_cents,
       p.name AS product_name
FROM checkout_items ci
JOIN products p ON p.id = ci.product_id
WHERE ci.session_id = $1;
