CREATE TABLE IF NOT EXISTS domains (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    master              VARCHAR(128) DEFAULT NULL,
    last_check          INT DEFAULT NULL,
    type                TEXT NOT NULL,
    notified_serial     BIGINT DEFAULT NULL,
    account             VARCHAR(40) DEFAULT NULL,
    options             TEXT DEFAULT NULL,
    catalog             TEXT DEFAULT NULL,
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE UNIQUE INDEX IF NOT EXISTS name_index ON domains(name);
CREATE INDEX IF NOT EXISTS catalog_idx ON domains(catalog);

CREATE TABLE IF NOT EXISTS records (
    id                  BIGSERIAL PRIMARY KEY,
    domain_id           INT DEFAULT NULL,
    name                VARCHAR(255) DEFAULT NULL,
    type                VARCHAR(10) DEFAULT NULL,
    content             VARCHAR(65535) DEFAULT NULL,
    ttl                 INT DEFAULT NULL,
    prio                INT DEFAULT NULL,
    disabled            BOOL DEFAULT 'f',
    ordername           VARCHAR(255),
    auth                BOOL DEFAULT 't',
    CONSTRAINT domain_exists FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE INDEX IF NOT EXISTS rec_name_index ON records(name);
CREATE INDEX IF NOT EXISTS nametype_index ON records(name, type);
CREATE INDEX IF NOT EXISTS domain_id ON records(domain_id);
CREATE INDEX IF NOT EXISTS recordorder ON records(domain_id, ordername text_pattern_ops);

CREATE TABLE IF NOT EXISTS supermasters (
    ip                  INET NOT NULL,
    nameserver          VARCHAR(255) NOT NULL,
    account             VARCHAR(40) NOT NULL,
    PRIMARY KEY(ip, nameserver)
);

CREATE TABLE IF NOT EXISTS comments (
    id                  SERIAL PRIMARY KEY,
    domain_id           INT NOT NULL,
    name                VARCHAR(255) NOT NULL,
    type                VARCHAR(10) NOT NULL,
    modified_at         INT NOT NULL,
    account             VARCHAR(40) DEFAULT NULL,
    comment             VARCHAR(65535) NOT NULL,
    CONSTRAINT domain_exists FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE INDEX IF NOT EXISTS comments_domain_id_idx ON comments (domain_id);
CREATE INDEX IF NOT EXISTS comments_name_type_idx ON comments (name, type);
CREATE INDEX IF NOT EXISTS comments_order_idx ON comments (domain_id, modified_at);

CREATE TABLE IF NOT EXISTS domainmetadata (
    id                  SERIAL PRIMARY KEY,
    domain_id           INT REFERENCES domains(id) ON DELETE CASCADE,
    kind                VARCHAR(32),
    content             TEXT
);
CREATE INDEX IF NOT EXISTS domainidmetaindex ON domainmetadata(domain_id);

CREATE TABLE IF NOT EXISTS cryptokeys (
    id                  SERIAL PRIMARY KEY,
    domain_id           INT REFERENCES domains(id) ON DELETE CASCADE,
    flags               INT NOT NULL,
    active              BOOL,
    published           BOOL DEFAULT TRUE,
    content             TEXT
);
CREATE INDEX IF NOT EXISTS domainidindex ON cryptokeys(domain_id);

CREATE TABLE IF NOT EXISTS tsigkeys (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255),
    algorithm           VARCHAR(50),
    secret              VARCHAR(255),
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE UNIQUE INDEX IF NOT EXISTS namealgoindex ON tsigkeys(name, algorithm);

-- App schema (our additions)
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.api_tokens (
    id          SERIAL PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.audit_log (
    id          BIGSERIAL PRIMARY KEY,
    token_id    INTEGER REFERENCES app.api_tokens(id),
    action      TEXT NOT NULL,
    subdomain   TEXT NOT NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_subdomain_idx ON app.audit_log (subdomain);
CREATE INDEX IF NOT EXISTS audit_created_idx ON app.audit_log (created_at DESC);
