CREATE TABLE products (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    image_url   TEXT,
    in_stock    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE checkout_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status          TEXT NOT NULL DEFAULT 'incomplete',
    currency        TEXT NOT NULL DEFAULT 'USD',
    subtotal_cents  INTEGER NOT NULL DEFAULT 0,
    discount_cents  INTEGER NOT NULL DEFAULT 0,
    total_cents     INTEGER NOT NULL DEFAULT 0,
    buyer_email     TEXT,
    payment_handler TEXT,
    payment_token   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checkout_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES checkout_sessions(id),
    product_id  UUID NOT NULL REFERENCES products(id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    price_cents INTEGER NOT NULL
);

INSERT INTO products (name, description, price_cents, image_url) VALUES
('Sunflower Bouquet', 'Bright and cheerful sunflower arrangement', 2499, '/images/sunflower.jpg'),
('Red Rose Arrangement', 'Classic dozen red roses in a glass vase', 3999, '/images/roses.jpg'),
('Lavender Bundle', 'Fragrant dried lavender bundle', 1899, '/images/lavender.jpg'),
('Mixed Wildflowers', 'Seasonal wildflower mix in rustic wrap', 2999, '/images/wildflowers.jpg'),
('Single White Lily', 'Elegant single stem white lily', 1299, '/images/lily.jpg');
