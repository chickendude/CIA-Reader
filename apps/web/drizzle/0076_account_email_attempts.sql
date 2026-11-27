CREATE TABLE account_email_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_signin boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
--> statement-breakpoint
CREATE INDEX account_email_attempts_created_idx ON account_email_attempts(created_at);
--> statement-breakpoint
-- Each existing link represented a send attempt. Include the current window on rollout.
INSERT INTO account_email_attempts(user_id, verified_signin, created_at)
SELECT l.user_id, coalesce(u.email_verified_at <= l.created_at, false), l.created_at
FROM magic_links l JOIN users u ON u.id = l.user_id
WHERE l.created_at > now() - interval '24 hours';
