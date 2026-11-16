-- The upload link's token, kept in clear so the same link can be shown again (spec: "Envio pelo Atalho do iOS").
ALTER TABLE memberships ADD COLUMN upload_token TEXT;
CREATE UNIQUE INDEX memberships_upload_token ON memberships(upload_token);
