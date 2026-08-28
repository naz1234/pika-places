PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS app_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO app_meta (id, version) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Food',
  map_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'want' CHECK (status IN ('want', 'planned', 'visited')),
  favourite INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1)),
  collection TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS places_updated ON places(updated_at);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS media_place ON media(place_id);
CREATE TABLE IF NOT EXISTS mutations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at);
CREATE TRIGGER IF NOT EXISTS places_insert_version AFTER INSERT ON places BEGIN UPDATE app_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS places_update_version AFTER UPDATE ON places BEGIN UPDATE app_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS media_insert_version AFTER INSERT ON media BEGIN UPDATE app_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS media_update_version AFTER UPDATE ON media BEGIN UPDATE app_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS media_delete_version AFTER DELETE ON media BEGIN UPDATE app_meta SET version = version + 1 WHERE id = 1; END;
