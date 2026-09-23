-- Help Ticket — koi bhi employee help ticket raise kar sakta hai. target_user_id
-- optional hai ("kisse help chahiye") — diya ho to wahi ticket dekh/resolve kar
-- sakta hai; Admin hamesha SAARE tickets dekhta hai, target ho ya na ho.
CREATE TABLE help_tickets (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  target_user_id int DEFAULT NULL,
  message text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'open',
  response text,
  resolved_by int DEFAULT NULL,
  resolved_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT help_tickets_status_chk CHECK (status IN ('open','resolved')),
  PRIMARY KEY (id),
  KEY help_tickets_idx_user (user_id),
  KEY help_tickets_idx_target (target_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
