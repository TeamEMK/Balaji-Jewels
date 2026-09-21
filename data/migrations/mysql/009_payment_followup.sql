CREATE TABLE client_payment_terms (
  user_id int NOT NULL,
  gold_days int DEFAULT NULL,
  diamond_days int DEFAULT NULL,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE client_bills (
  id int NOT NULL AUTO_INCREMENT,
  client_user_id int NOT NULL,
  bill_no varchar(100) DEFAULT '',
  bill_date date NOT NULL,
  gold_amount decimal(14,2) NOT NULL DEFAULT 0,
  diamond_amount decimal(14,2) NOT NULL DEFAULT 0,
  gold_paid decimal(14,2) NOT NULL DEFAULT 0,
  diamond_paid decimal(14,2) NOT NULL DEFAULT 0,
  source varchar(20) NOT NULL DEFAULT 'manual',
  fms_ref varchar(255) DEFAULT NULL,
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY client_bills_fms_ref_uq (fms_ref),
  KEY client_bills_idx_client (client_user_id),
  KEY client_bills_idx_date (bill_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE client_payments (
  id int NOT NULL AUTO_INCREMENT,
  bill_id int NOT NULL,
  payment_date date NOT NULL,
  gold_amount decimal(14,2) NOT NULL DEFAULT 0,
  diamond_amount decimal(14,2) NOT NULL DEFAULT 0,
  note text,
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY client_payments_idx_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
