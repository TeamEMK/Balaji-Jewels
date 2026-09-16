-- Leave Tracker & Payroll Management
-- Salary employee record me hi rakhte hain (department/week_off jaisa hi).
ALTER TABLE users ADD COLUMN monthly_salary numeric(12,2) DEFAULT NULL;

-- Attendance machine se upload hui data, ek row per employee per month.
-- days_present decimal isliye hai ki half-din bhi ho sakte hain.
-- UNIQUE(user_id, month) — dobara upload karne par purani value replace hoti
-- hai (upsert), duplicate row nahi banti.
CREATE TABLE attendance_records (
  id serial,
  user_id int NOT NULL,
  month varchar(7) NOT NULL, -- 'YYYY-MM'
  days_present numeric(5,1) NOT NULL,
  uploaded_by int DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  CONSTRAINT attendance_records_uq UNIQUE (user_id, month)
);
CREATE INDEX attendance_records_idx_month ON attendance_records (month);
