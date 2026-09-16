-- Leave Tracker & Payroll Management
ALTER TABLE users ADD COLUMN monthly_salary decimal(12,2) DEFAULT NULL;

CREATE TABLE attendance_records (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  month varchar(7) NOT NULL,
  days_present decimal(5,1) NOT NULL,
  uploaded_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT attendance_records_uq UNIQUE (user_id, month),
  KEY attendance_records_idx_month (month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
