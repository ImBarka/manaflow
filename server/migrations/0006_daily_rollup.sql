-- The team page used to aggregate every session's JSON segments on each load,
-- which read tens of thousands of rows per view and exhausted the free plan's
-- daily read allowance. The collector now sends each day already rolled up,
-- so a view reads one row per device and day.
-- breakdown is NULL for days pushed by a collector that predates this.
ALTER TABLE daily ADD COLUMN sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily ADD COLUMN sessions_started INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily ADD COLUMN input_tokens INTEGER;
ALTER TABLE daily ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE daily ADD COLUMN breakdown TEXT;
CREATE INDEX daily_day ON daily (day);
