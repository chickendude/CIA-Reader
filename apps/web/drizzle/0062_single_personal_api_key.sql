ALTER TABLE personal_api_keys ALTER COLUMN name DROP NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX personal_api_keys_one_active_per_user
  ON personal_api_keys (user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
DROP INDEX personal_api_keys_active_user_idx;
