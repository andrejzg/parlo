ALTER TABLE creators ADD COLUMN api_key TEXT;
CREATE UNIQUE INDEX idx_creators_api_key ON creators(api_key) WHERE api_key IS NOT NULL;
