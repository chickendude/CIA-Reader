CREATE TABLE blocked_networks (
  network text PRIMARY KEY,
  blocked_at timestamptz NOT NULL DEFAULT now()
);
