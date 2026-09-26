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
  id serial,
  client_user_id int NOT NULL,
  entry_date date NOT NULL,
  particular varchar(100) NOT NULL DEFAULT 'Sale Bill',
  gold_wt_18k numeric(12,3) NOT NULL DEFAULT 0,
  gold_wt_14k numeric(12,3) NOT NULL DEFAULT 0,
  gold_wt_9k numeric(12,3) NOT NULL DEFAULT 0,
  pure_wt_override numeric(12,3) DEFAULT NULL, -- NULL = purity settings se auto-calculate; value diya ho to usi ko use karo
  fix_status varchar(10) NOT NULL DEFAULT 'unfixed',
  gold_rate numeric(12,2) DEFAULT NULL, -- Rs per gram (pure wt par) — Fix karte waqt bharta hai
  gold_amount numeric(14,2) NOT NULL DEFAULT 0, -- 'Gold Amt as per Invoice' — Fix hone par bharta hai
  diamond_labour_amount numeric(14,2) NOT NULL DEFAULT 0,
  recvd_against_dia_labour numeric(14,2) NOT NULL DEFAULT 0,
  recvd_against_gold numeric(14,2) NOT NULL DEFAULT 0,
  pg_gold_wt numeric(12,3) DEFAULT NULL, -- PDF ka 'PG Gold WT' column — abhi manual (matlab confirm hone tak)
  balance_direction varchar(10) NOT NULL DEFAULT 'add', -- 'add' | 'subtract' — gold weight running balance is entry se badhega ya ghatega
  counts_as_sale smallint NOT NULL DEFAULT 1, -- 1 = Avg Gold Rate Sold nikalte waqt is entry ko ginna hai
  note text,
  created_by int DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT gold_ledger_fix_chk CHECK (fix_status IN ('fixed','unfixed')),
  CONSTRAINT gold_ledger_dir_chk CHECK (balance_direction IN ('add','subtract')),
  PRIMARY KEY (id)
);
CREATE INDEX gold_ledger_idx_client ON gold_ledger_entries(client_user_id);
CREATE INDEX gold_ledger_idx_date ON gold_ledger_entries(entry_date);
