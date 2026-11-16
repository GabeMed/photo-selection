CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  name TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  google_sub TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE selfies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX selfies_user ON selfies(user_id);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  quota_bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  uploader_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  preview_bytes INTEGER,
  thumb_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL CHECK (status IN ('enviando', 'recebida', 'processando', 'processada', 'falhou')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  status_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX photos_group ON photos(group_id, created_at DESC, id DESC);
CREATE INDEX photos_uploader_month ON photos(uploader_id, created_at);
CREATE INDEX photos_status ON photos(status, status_at);

-- Embeddings are 512 little-endian Float32 values (2 KB per face).
CREATE TABLE faces (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  box TEXT NOT NULL,
  det_score REAL NOT NULL,
  embedding BLOB NOT NULL
);
CREATE INDEX faces_photo ON faces(photo_id);

-- Best cosine between the photo's faces and the user's selfies, kept even below the threshold.
CREATE TABLE scores (
  photo_id TEXT NOT NULL REFERENCES photos(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  score REAL NOT NULL,
  PRIMARY KEY (photo_id, user_id)
);
CREATE INDEX scores_user ON scores(user_id);

CREATE TABLE tags (
  photo_id TEXT NOT NULL REFERENCES photos(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  value TEXT NOT NULL CHECK (value IN ('me', 'not_me')),
  PRIMARY KEY (photo_id, user_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('max_groups', '5'),
  ('default_group_quota_bytes', '2147483648'),
  ('user_monthly_quota_bytes', '1073741824'),
  ('max_file_bytes', '104857600'),
  ('match_threshold', '0.45');
