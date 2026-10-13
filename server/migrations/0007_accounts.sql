-- Which Claude account a session was recorded under. Claude Code's session
-- files do not name the account, so the collector marks a session with the
-- account that was signed in when it last saw the session change. `id` is an
-- opaque hash of the account id; the label is a masked email.
CREATE TABLE accounts (
  member_id INTEGER NOT NULL REFERENCES members(id),
  id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  org TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (member_id, id)
);

ALTER TABLE sessions ADD COLUMN account_id TEXT;
