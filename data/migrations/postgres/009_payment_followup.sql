-- Payment Followup System — gold aur diamond payment alag-alag track hote
-- hain. Client wahi 'client' role wale users hain (Catalog dekhne wale).

-- Har client ke payment terms (gold 10-15 din, diamond 45-60 din jaisa).
-- User se alag table isliye rakhi — sirf 'client' role par lagu hote hain,
-- users table ko is se bhaari nahi karna.
CREATE TABLE client_payment_terms (
  user_id int NOT NULL,
  gold_days int DEFAULT NULL,
  diamond_days int DEFAULT NULL,
  updated_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id)
);

-- Bills — manual entry ya FMS se sync dono se yahan aate hain. source +
-- fms_ref se dobara sync karne par duplicate nahi bante.
CREATE TABLE client_bills (
  id serial,
  client_user_id int NOT NULL,
  bill_no varchar(100) DEFAULT '',
  bill_date date NOT NULL,
  gold_amount numeric(14,2) NOT NULL DEFAULT 0,
  diamond_amount numeric(14,2) NOT NULL DEFAULT 0,
  gold_paid numeric(14,2) NOT NULL DEFAULT 0,
  diamond_paid numeric(14,2) NOT NULL DEFAULT 0,
  source varchar(20) NOT NULL DEFAULT 'manual',
  fms_ref varchar(255) DEFAULT NULL,
  created_by int DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  CONSTRAINT client_bills_source_chk CHECK (source IN ('manual','fms')),
  CONSTRAINT client_bills_fms_ref_uq UNIQUE (fms_ref)
);
CREATE INDEX client_bills_idx_client ON client_bills (client_user_id);
CREATE INDEX client_bills_idx_date ON client_bills (bill_date);

-- Payment history — audit trail. gold_paid/diamond_paid upar client_bills
-- par cumulative hai (jaldi pending nikalne ke liye), ye table batati hai
-- KAB kitna paisa aaya.
CREATE TABLE client_payments (
  id serial,
  bill_id int NOT NULL,
  payment_date date NOT NULL,
  gold_amount numeric(14,2) NOT NULL DEFAULT 0,
  diamond_amount numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  created_by int DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);
CREATE INDEX client_payments_idx_bill ON client_payments (bill_id);
