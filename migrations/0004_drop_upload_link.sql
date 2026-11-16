-- The Shortcut upload link was removed: sending from the Files app made it unnecessary.
DROP INDEX IF EXISTS memberships_upload_token;
ALTER TABLE memberships DROP COLUMN upload_token;
