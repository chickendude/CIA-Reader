CREATE TABLE signup_retries (
  network text NOT NULL,
  day date NOT NULL DEFAULT ((statement_timestamp() AT TIME ZONE 'UTC')::date),
  attempts integer NOT NULL DEFAULT 1,
  last_attempt_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (day, network)
);
