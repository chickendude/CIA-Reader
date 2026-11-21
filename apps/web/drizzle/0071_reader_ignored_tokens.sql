CREATE TABLE reader_ignored_tokens (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES text_tokens(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, token_id)
);
--> statement-breakpoint
CREATE INDEX reader_ignored_tokens_token_idx ON reader_ignored_tokens(token_id);
