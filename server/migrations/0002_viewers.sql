-- People allowed to open the dashboard. One token per person so access can be
-- revoked individually.
CREATE TABLE viewers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
