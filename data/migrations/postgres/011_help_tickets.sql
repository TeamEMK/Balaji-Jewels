-- Help Ticket — koi bhi employee help ticket raise kar sakta hai. target_user_id
-- optional hai ("kisse help chahiye") — diya ho to wahi ticket dekh/resolve kar
-- sakta hai; Admin hamesha SAARE tickets dekhta hai, target ho ya na ho.
CREATE TABLE help_tickets (
  id serial,
  user_id int NOT NULL,
  target_user_id int DEFAULT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  response text,
  resolved_by int DEFAULT NULL,
  resolved_at timestamp DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT help_tickets_status_chk CHECK (status IN ('open','resolved')),
  PRIMARY KEY (id)
);
CREATE INDEX help_tickets_idx_user ON help_tickets(user_id);
CREATE INDEX help_tickets_idx_target ON help_tickets(target_user_id);
