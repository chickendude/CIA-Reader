CREATE TABLE user_networks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  signup_at timestamptz,
  PRIMARY KEY (user_id, network)
);
--> statement-breakpoint
CREATE INDEX user_networks_network_idx ON user_networks(network, last_seen_at);
--> statement-breakpoint
CREATE INDEX user_networks_expiry_idx ON user_networks(last_seen_at);
