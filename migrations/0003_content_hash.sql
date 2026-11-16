-- SHA-256 of the original, lowercase hex, null until known (spec: "Fotos duplicadas").
ALTER TABLE photos ADD COLUMN content_hash TEXT;
CREATE INDEX photos_group_content_hash ON photos(group_id, content_hash);
