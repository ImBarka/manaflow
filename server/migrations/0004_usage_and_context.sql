-- The per-member Usage and Context views are rendered from the same payloads
-- codeburn's own web dashboard uses, stored as received: one row per device and
-- period, overwritten on every push.
CREATE TABLE usage_payloads (
  device_id TEXT NOT NULL REFERENCES devices(id),
  period TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, period)
);

CREATE TABLE context_trees (
  device_id TEXT NOT NULL REFERENCES devices(id),
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id),
  title TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, provider, session_id)
);
