-- Kaam ki na rahi cheezein hata do.
--
-- PURANE legacy tables — meetings, tasks, daily_tasks, config, message_logs.
-- Ye kisi purane system se aayi thi; is app ka code inme se kisi ko na padhta
-- hai na likhta (poore repo me ek bhi reference nahi). Isi wajah se har copy
-- me ye khaali hi rehti hain.
--
-- Ye migration WAPAS nahi ho sakti — aur MySQL me DDL rollback bhi nahi hota,
-- isliye chalane se pehle ek baar dekh lein ki in tables me sach me kuch nahi:
--
--   SELECT 'meetings', count(*) FROM meetings
--   UNION ALL SELECT 'tasks', count(*) FROM tasks
--   UNION ALL SELECT 'daily_tasks', count(*) FROM daily_tasks
--   UNION ALL SELECT 'config', count(*) FROM config
--   UNION ALL SELECT 'message_logs', count(*) FROM message_logs;
--
-- ── Postgres wali file se ek farak ───────────────────
-- Us file me CLIENT feature ka ek aur hissa bhi hai:
--
--   DROP INDEX IF EXISTS delegation_tasks_idx_client;  (aur do aur)
--   ALTER TABLE delegation_tasks DROP COLUMN IF EXISTS client_id;  (aur do aur)
--
-- Wo isliye hai ki kuch purane Postgres database pehle se chal rahe the jinme
-- ye columns pade the. Yahan wo statements JAAN-BOOJH KAR nahi hain:
--
--   1. Ye MySQL copy hamesha khaali database par chadhti hai, aur 001_init.sql
--      delegation_tasks / checklist_tasks / users me client_id banata hi nahi.
--      (client_id sirf meetings aur tasks me hai — aur wo dono neeche poori
--      table ke saath chali jaati hain.)
--   2. MySQL me DROP INDEX aur DROP COLUMN par IF EXISTS chalta hi nahi. Bina
--      us guard ke ye statements "column not found" par migration rok deti —
--      aur MySQL me aadhi chali hui migration wapas nahi mudti.
--
-- DROP TABLE par IF EXISTS MySQL me chalta hai, isliye wo waisa ka waisa hai.

DROP TABLE IF EXISTS meetings;
DROP TABLE IF EXISTS daily_tasks;
DROP TABLE IF EXISTS message_logs;
DROP TABLE IF EXISTS config;
DROP TABLE IF EXISTS tasks;
