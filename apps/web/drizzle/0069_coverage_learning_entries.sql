-- Existing cache rows get their headword counts on the next coverage lookup.
ALTER TABLE reader_coverage_cache ADD COLUMN learning_entries integer[];
