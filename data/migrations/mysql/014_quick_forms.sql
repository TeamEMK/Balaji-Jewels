-- Quick Forms — koi bhi logged-in user form ka naam+link add kar sakta hai,
-- sidebar ke "Forms" page se ek click me wo form naye tab me khul jaata hai.
-- Koi role-restriction nahi (sab add/edit/delete kar sakte hain) — jaisa
-- user ne khud chaha.
CREATE TABLE quick_forms (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  link text NOT NULL,
  added_by int NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY quick_forms_idx_added_by (added_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
