-- Gold Ledger — per-client, PDF jaisa (18K/14K/9K weight, Fix/Unfix status,
-- running balance). Client Ledger ke andar ek naya tab. Purani 'Bills' se
-- ALAG hai — wahi ek client ke saath 2 tarah ka record ho sakta hai:
-- simple rupee-bill (client_bills) aur weight-based gold ledger (yahan).
--
-- balance_direction aur counts_as_sale explicit fields hain (particular text
-- se guess nahi karte) — kyunki 'Recvd Gold' jaisi entry positive weight ke
-- saath likhi jaati hai lekin balance se GHATTI hai, jabki 'Return' negative
-- weight ke saath likhi jaati hai aur seedhe jud jaati hai. Admin khud batata
-- hai ki ye entry balance me judegi ya ghategi.
CREATE TABLE gold_ledger_entries (
  id int NOT NULL AUTO_INCREMENT,
  client_user_id int NOT NULL,
  entry_date date NOT NULL,
  particular varchar(100) NOT NULL DEFAULT 'Sale Bill',
  gold_wt_18k decimal(12,3) NOT NULL DEFAULT 0,
  gold_wt_14k decimal(12,3) NOT NULL DEFAULT 0,
  gold_wt_9k decimal(12,3) NOT NULL DEFAULT 0,
  pure_wt_override decimal(12,3) DEFAULT NULL,
  fix_status varchar(10) NOT NULL DEFAULT 'unfixed',
  gold_rate decimal(12,2) DEFAULT NULL,
  gold_amount decimal(14,2) NOT NULL DEFAULT 0,
  diamond_labour_amount decimal(14,2) NOT NULL DEFAULT 0,
  recvd_against_dia_labour decimal(14,2) NOT NULL DEFAULT 0,
  recvd_against_gold decimal(14,2) NOT NULL DEFAULT 0,
  pg_gold_wt decimal(12,3) DEFAULT NULL,
  balance_direction varchar(10) NOT NULL DEFAULT 'add',
  counts_as_sale tinyint NOT NULL DEFAULT 1,
  note text,
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT gold_ledger_fix_chk CHECK (fix_status IN ('fixed','unfixed')),
  CONSTRAINT gold_ledger_dir_chk CHECK (balance_direction IN ('add','subtract')),
  PRIMARY KEY (id),
  KEY gold_ledger_idx_client (client_user_id),
  KEY gold_ledger_idx_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
