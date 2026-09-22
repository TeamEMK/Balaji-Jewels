-- Multi-day leave apply karte waqt optional attachment (doctor's
-- prescription, wedding card, PDF waghera) — image ya PDF, base64 data URI
-- ke roop me. 'text' — Postgres me text ki koi size limit nahi (MySQL wale
-- migration me isliye longtext hai).
ALTER TABLE leave_requests ADD COLUMN attachment text;
ALTER TABLE leave_requests ADD COLUMN attachment_name varchar(200) DEFAULT NULL;
