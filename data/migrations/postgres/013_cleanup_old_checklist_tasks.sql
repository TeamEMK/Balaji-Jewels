-- Ek-baar cleanup: Checklist me aaj se pehle ke purane PENDING tasks hata do,
-- taaki checklist me aaj ki date se aage ke tasks hi dikhein.
-- Completed tasks kabhi nahi chhuye — unka data Employee Records / MIS
-- reports me purani dates ki performance history ke liye use hota hai
-- (jaise /api/tasks/checklist-year-delete bulk-delete me bhi completed
-- tasks hamesha bache rehte hain, isi rule ko yahan follow kiya).
DELETE FROM checklist_tasks WHERE due_date < CURRENT_DATE AND (status IS NULL OR status <> 'completed');
