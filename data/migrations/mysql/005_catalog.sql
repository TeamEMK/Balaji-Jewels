-- Catalog — jewelry items jo clients ko dikhaye jaate hain (naya 'client' login
-- role isi ko dekh sakta hai). image longtext hai (na ki text) — base64 photo
-- MySQL ke text (64KB max) me nahi samaayegi.
CREATE TABLE catalog_items (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  description text,
  price decimal(12,2),
  image longtext,
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY catalog_items_idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
