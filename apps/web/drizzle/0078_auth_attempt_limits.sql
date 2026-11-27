CREATE TABLE signup_windows (
  network text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
INSERT INTO signup_windows(network, expires_at)
SELECT network, max(signup_at) + interval '24 hours'
FROM user_networks WHERE signup_at > now() - interval '24 hours'
GROUP BY network;
--> statement-breakpoint
CREATE TABLE password_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL,
  email_key text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (statement_timestamp() + interval '15 minutes')
);
--> statement-breakpoint
CREATE INDEX password_failures_network_idx ON password_failures(network, expires_at);
--> statement-breakpoint
CREATE INDEX password_failures_email_idx ON password_failures(email_key, expires_at);
--> statement-breakpoint
CREATE INDEX password_failures_expiry_idx ON password_failures(expires_at);
