-- Mirror LinkedIn profile photos into R2 so they don't break when LinkedIn's
-- signed CDN URLs expire (~30d). Keeps the original URL column around for
-- the lazy-backfill path; new connections write the R2 key directly.
ALTER TABLE creators ADD COLUMN linkedin_photo_r2_key TEXT;
