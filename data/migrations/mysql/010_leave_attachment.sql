-- Multi-day leave apply karte waqt optional attachment (doctor's
-- prescription, wedding card, PDF waghera) — image ya PDF, base64 data URI
-- ke roop me. longtext — MySQL text 64KB tak hi hoti, base64 file usse
-- bada ho sakta hai.
ALTER TABLE leave_requests ADD COLUMN attachment longtext;
ALTER TABLE leave_requests ADD COLUMN attachment_name varchar(200) DEFAULT NULL;
