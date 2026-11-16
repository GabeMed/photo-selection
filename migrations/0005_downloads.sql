-- Which originals each person asked for (spec: "Histórico de downloads"); only the first date is kept.
CREATE TABLE downloads (
  user_id TEXT NOT NULL REFERENCES users(id),
  photo_id TEXT NOT NULL REFERENCES photos(id),
  downloaded_at TEXT NOT NULL,
  PRIMARY KEY (user_id, photo_id)
);
CREATE INDEX downloads_photo ON downloads(photo_id);
