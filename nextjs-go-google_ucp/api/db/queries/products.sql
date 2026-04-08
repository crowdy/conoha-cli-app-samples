-- name: ListProducts :many
SELECT id, name, description, price_cents, currency, image_url, in_stock
FROM products
WHERE in_stock = true
ORDER BY name;

-- name: GetProduct :one
SELECT id, name, description, price_cents, currency, image_url, in_stock
FROM products
WHERE id = $1;
