CREATE TABLE hindi_review_ignored (
  text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  surface text NOT NULL,
  PRIMARY KEY (text_id, surface)
);
--> statement-breakpoint
CREATE TABLE hindi_reference_cache (
  key text PRIMARY KEY,
  result jsonb NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
