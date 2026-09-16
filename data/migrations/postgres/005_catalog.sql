-- Catalog — jewelry items jo clients ko dikhaye jaate hain (naya 'client' login
-- role isi ko dekh sakta hai). 'client' role already users_role_chk me allowed
-- tha (001_init.sql), bas ab wired up ho raha hai.
CREATE TABLE catalog_items (
  id serial,
  name varchar(255) NOT NULL,
  description text,
  price numeric(12,2),
  image text,
  created_by int DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);
CREATE INDEX catalog_items_idx_created ON catalog_items (created_at DESC);
