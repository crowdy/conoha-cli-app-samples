-- +goose Up
CREATE TABLE countdowns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_at   INTEGER NOT NULL,
  label       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);
CREATE INDEX idx_countdowns_target ON countdowns(target_at);

CREATE TABLE cache (
  key         TEXT    PRIMARY KEY,
  payload     TEXT    NOT NULL,
  fetched_at  INTEGER NOT NULL,
  last_error  TEXT
);

-- +goose Down
DROP INDEX IF EXISTS idx_countdowns_target;
DROP TABLE IF EXISTS countdowns;
DROP TABLE IF EXISTS cache;
