-- Quick Forms — koi bhi logged-in user form ka naam+link add kar sakta hai,
-- sidebar ke "Forms" page se ek click me wo form naye tab me khul jaata hai.
-- Koi role-restriction nahi (sab add/edit/delete kar sakte hain) — jaisa
-- user ne khud chaha.
CREATE TABLE quick_forms (
  id serial,
  name text NOT NULL,
  link text NOT NULL,
  added_by int NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);
CREATE INDEX quick_forms_idx_added_by ON quick_forms(added_by);
