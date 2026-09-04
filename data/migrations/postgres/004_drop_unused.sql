-- Kaam ki na rahi cheezein hata do.
--
-- Do hisse hain:
--
--   1. CLIENT feature — ab app me hai hi nahi. 001_init.sql se uski tables aur
--      columns nikal chuke hain, par jo database pehle se chal rahe hain unme
--      wo abhi bhi padi hain. Sabse zyada matlab do indexes ka hai
--      (delegation_tasks / checklist_tasks par client_id ke): un par ab koi
--      query nahi chalti, par HAR task insert unhe update karta hai.
--
--   2. PURANE legacy tables — meetings, tasks, daily_tasks, config,
--      message_logs. Ye kisi purane system se aayi thi; is app ka code inme se
--      kisi ko na padhta hai na likhta (poore repo me ek bhi reference nahi).
--      Isi wajah se har copy me ye khaali hi rehti hain.
--
-- Ye migration WAPAS nahi ho sakti. Chalane se pehle ek baar dekh lein ki in
-- tables me sach me kuch nahi hai:
--
--   SELECT 'meetings', count(*) FROM meetings
--   UNION ALL SELECT 'tasks', count(*) FROM tasks
--   UNION ALL SELECT 'daily_tasks', count(*) FROM daily_tasks
--   UNION ALL SELECT 'config', count(*) FROM config
--   UNION ALL SELECT 'message_logs', count(*) FROM message_logs
--   UNION ALL SELECT 'clients', count(*) FROM clients;
--
-- Sab jagah IF EXISTS lagaya hai kyunki ye file NAYE database par bhi chalti
-- hai — wahan 001_init.sql ne ye cheezein banayi hi nahi hoti, aur bina
-- IF EXISTS ke migration wahin ruk jaata.

-- ── 1. Client feature ─────────────────────────────────
DROP INDEX IF EXISTS delegation_tasks_idx_client;
DROP INDEX IF EXISTS checklist_tasks_idx_client;
DROP INDEX IF EXISTS users_idx_client;

ALTER TABLE delegation_tasks DROP COLUMN IF EXISTS client_id;
ALTER TABLE checklist_tasks  DROP COLUMN IF EXISTS client_id;
ALTER TABLE users            DROP COLUMN IF EXISTS client_id;

DROP TABLE IF EXISTS client_department_folders;
DROP TABLE IF EXISTS client_feedback;
DROP TABLE IF EXISTS client_handlers;
DROP TABLE IF EXISTS clients;

-- ── 2. Purane legacy tables ───────────────────────────
-- Inke apne indexes tables ke saath hi chale jaate hain.
DROP TABLE IF EXISTS meetings;
DROP TABLE IF EXISTS daily_tasks;
DROP TABLE IF EXISTS message_logs;
DROP TABLE IF EXISTS config;
DROP TABLE IF EXISTS tasks;
