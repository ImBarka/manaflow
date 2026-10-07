CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  name TEXT NOT NULL,
  os TEXT NOT NULL DEFAULT '',
  collector_version TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- One row per session. `models` and `segments` are JSON, so a changed session
-- costs a single row write against the D1 daily write budget.
CREATE TABLE sessions (
  device_id TEXT NOT NULL REFERENCES devices(id),
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id),
  title TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  models TEXT NOT NULL DEFAULT '[]',
  cost REAL NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT '',
  ended_at TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  segments TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, provider, session_id)
);

CREATE INDEX sessions_member_started ON sessions (member_id, started_at);

CREATE TABLE daily (
  device_id TEXT NOT NULL REFERENCES devices(id),
  day TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id),
  cost REAL NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  edit_turns INTEGER NOT NULL DEFAULT 0,
  one_shot_turns INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, day)
);
