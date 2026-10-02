-- macc.lol/photo schema. Safe to run more than once.

-- Anyone who joined with the invite code. Names are unique, case-insensitively.
CREATE TABLE IF NOT EXISTS members (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL UNIQUE,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- One row per photo. The image bytes live in R2 at full/<id>.jpg and thumb/<id>.jpg.
-- song is JSON: { id, title, artist, artwork, preview, link, start } or NULL.
CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  song       TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS photos_newest ON photos (created_at DESC, id DESC);

-- Failed invite-code attempts per IP, to slow down guessing.
CREATE TABLE IF NOT EXISTS join_attempts (
  ip       TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
