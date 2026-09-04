-- Task tables ke index ko asli query shape par laao.
--
-- Dashboard, All Tasks, stats aur cron — sab teen columns par SAATH me filter
-- karte hain aur due_date se sort karte hain:
--
--   WHERE status = ? AND due_date <= ? AND assigned_to = ?  ORDER BY due_date
--
-- Par index teen ALAG single-column the (assigned_to / status / due_date).
-- Ek composite index inme se har ek se behtar hai: pehle do columns equality
-- par, teesra range + ORDER BY par — isliye alag sort step lagti hi nahi.
--
-- (Postgres par ye naap kar dekha gaya tha: poore query suite me 4,249 shared
-- blocks se 1,423 — teen guna kam. MySQL ka planner alag hai par index ki
-- shakl usi wajah se sahi hai: leftmost prefix rule yahan bhi wahi kaam karta
-- hai.)
--
-- Do composite kaafi hain:
--   (assigned_to, status, due_date) — per-user screens. Iska leftmost prefix
--       (assigned_to) purane akele index ka kaam bhi kar deta hai.
--   (status, due_date)             — admin/all-users screens aur cron.
--
-- Isi liye teeno purane single-column index ab bekaar hain. Unhe rakhna sirf
-- kharcha hai: har INSERT/UPDATE unhe bhi update karta hai aur wo RAM me jagah
-- ghere rehte hain.

CREATE INDEX checklist_tasks_idx_doer_status_due
    ON checklist_tasks (assigned_to, status, due_date);
CREATE INDEX checklist_tasks_idx_status_due
    ON checklist_tasks (status, due_date);

CREATE INDEX delegation_tasks_idx_doer_status_due
    ON delegation_tasks (assigned_to, status, due_date);
CREATE INDEX delegation_tasks_idx_status_due
    ON delegation_tasks (status, due_date);

-- MySQL me DROP INDEX ke saath table ka naam dena padta hai, aur IF EXISTS
-- chalta hi nahi (Postgres wali file me wo laga hai). Yahan uski zarurat bhi
-- nahi: ye chhah ke chhah index 001_init.sql me banti hain, isliye is kram me
-- hamesha maujood hoti hain.
DROP INDEX checklist_tasks_idx_assigned_to ON checklist_tasks;
DROP INDEX checklist_tasks_idx_status      ON checklist_tasks;
DROP INDEX checklist_tasks_idx_due_date    ON checklist_tasks;

DROP INDEX delegation_tasks_idx_assigned_to ON delegation_tasks;
DROP INDEX delegation_tasks_idx_status      ON delegation_tasks;
DROP INDEX delegation_tasks_idx_due_date    ON delegation_tasks;
