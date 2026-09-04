-- Task tables ke index ko asli query shape par laao.
--
-- Dashboard, All Tasks, stats aur cron — sab teen columns par SAATH me filter
-- karte hain aur due_date se sort karte hain:
--
--   WHERE status = ? AND due_date <= ? AND assigned_to = ?  ORDER BY due_date
--
-- Par index teen ALAG single-column the (assigned_to / status / due_date).
-- Postgres unme se ek chunta tha ya do ko bitmap-AND karta tha — dono me kaafi
-- zyada blocks padhne padte the.
--
-- 47,000 checklist_tasks rows par naapa gaya (EXPLAIN ANALYZE, shared blocks):
--
--   query                purane index   naye index
--   dashboard (user)              13            2
--   dashboard (admin)          2,844          502
--   stats (user)                 525            5
--   MIS (ek user, range)          48           42
--   ─────────────────────────────────────────────
--   poora suite                4,249        1,423     (3x kam)
--   index size                 1.3 MB       1.1 MB
--
-- Do composite kaafi hain:
--   (assigned_to, status, due_date) — per-user screens. Pehle do columns
--       equality, teesra range + ORDER BY, isliye alag sort nahi lagti.
--       Iska leftmost prefix (assigned_to) purane akele index ka kaam bhi
--       kar deta hai.
--   (status, due_date)             — admin/all-users screens aur cron.
--
-- Isi liye teeno purane single-column index ab bekaar hain. Unhe rakhna sirf
-- kharcha hai: har INSERT/UPDATE unhe bhi update karta hai aur wo RAM me jagah
-- ghere rehte hain.
--
-- client_id wala index chhoda hai — wo alag queries ke kaam aata hai.

CREATE INDEX checklist_tasks_idx_doer_status_due
    ON checklist_tasks (assigned_to, status, due_date);
CREATE INDEX checklist_tasks_idx_status_due
    ON checklist_tasks (status, due_date);

CREATE INDEX delegation_tasks_idx_doer_status_due
    ON delegation_tasks (assigned_to, status, due_date);
CREATE INDEX delegation_tasks_idx_status_due
    ON delegation_tasks (status, due_date);

DROP INDEX IF EXISTS checklist_tasks_idx_assigned_to;
DROP INDEX IF EXISTS checklist_tasks_idx_status;
DROP INDEX IF EXISTS checklist_tasks_idx_due_date;

DROP INDEX IF EXISTS delegation_tasks_idx_assigned_to;
DROP INDEX IF EXISTS delegation_tasks_idx_status;
DROP INDEX IF EXISTS delegation_tasks_idx_due_date;
