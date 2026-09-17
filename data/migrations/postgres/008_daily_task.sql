-- Daily Task (timesheet) — employee roz apna time client + department + task
-- ke hisaab se log karta hai. 'daily' (normal kaam) aur 'extra_working'
-- (overtime) dono isi table me, log_type se alag hote hain.
CREATE TABLE daily_task_logs (
  id serial,
  user_id int NOT NULL,
  entry_date date NOT NULL,
  log_type varchar(20) NOT NULL DEFAULT 'daily',
  client_name varchar(255) DEFAULT '',
  department varchar(255) DEFAULT '',
  description text,
  minutes int NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_task_logs_type_chk CHECK (log_type IN ('daily','extra_working')),
  PRIMARY KEY (id)
);
CREATE INDEX daily_task_logs_idx_user_date ON daily_task_logs (user_id, entry_date);
