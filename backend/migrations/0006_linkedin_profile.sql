-- Add LinkedIn profile fields to creators
ALTER TABLE creators ADD COLUMN linkedin_sub TEXT;
ALTER TABLE creators ADD COLUMN linkedin_name TEXT;
ALTER TABLE creators ADD COLUMN linkedin_email TEXT;
ALTER TABLE creators ADD COLUMN linkedin_photo_url TEXT;
ALTER TABLE creators ADD COLUMN linkedin_connected_at TEXT;
