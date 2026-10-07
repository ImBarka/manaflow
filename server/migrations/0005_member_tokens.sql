-- Extra tokens for a member, so a second laptop can be added without replacing
-- (and thereby disconnecting) the token the first one uses. The member's
-- original token stays in members.token_hash.
CREATE TABLE member_tokens (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
