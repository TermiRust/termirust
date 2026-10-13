-- Vault metadata: exactly one row.
CREATE TABLE vault_meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  vault_id       TEXT    NOT NULL,
  format_version INTEGER NOT NULL,
  key_check      BLOB    NOT NULL,
  created_at     INTEGER NOT NULL
);

-- Every user record (host, group, identity, …), encrypted one by one.
CREATE TABLE items (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL,
  revision        INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  nonce           BLOB,
  ciphertext      BLOB,
  sync_state      TEXT    NOT NULL DEFAULT 'local' CHECK (sync_state IN ('local', 'dirty', 'synced')),
  server_revision INTEGER,
  CHECK ((deleted_at IS NULL) = (ciphertext IS NOT NULL AND nonce IS NOT NULL))
);
CREATE INDEX idx_items_kind ON items(kind) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_sync ON items(sync_state);

-- Device-local, non-secret preferences; never synced.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
