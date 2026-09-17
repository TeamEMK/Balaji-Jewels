CREATE TABLE daily_task_logs (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  entry_date date NOT NULL,
  log_type varchar(20) NOT NULL DEFAULT 'daily',
  client_name varchar(255) DEFAULT '',
  department varchar(255) DEFAULT '',
  description text,
  minutes int NOT NULL DEFAULT 0,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY daily_task_logs_idx_user_date (user_id, entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
